import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

type Task = { id:string; title:string; category:string; est:number; donePoms:number; completed:boolean; createdAt:string };
type Log  = { id:string; date:string; seconds:number; category:string; taskId?:string };

const uid=()=>Math.random().toString(36).slice(2,10);
const today=()=>{ const d=new Date(); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${da}`; };
const mmss=(s:number)=>{ s=Math.max(0,Math.floor(s)); const m=Math.floor(s/60), r=s%60; return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`; };
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

const LS={ tasks:"znldk_tasks_v2", settings:"znldk_settings_v2", log:"znldk_log_v2", streak:"znldk_streak_v2" };
const DEFAULT = { workMin:25, shortMin:5, longMin:15, longEvery:4, autoNext:true, sound:true, goalPerDay:6 };

function useLocalStorage<T>(key:string, init:T){
  const [v,setV]=useState<T>(()=>{ try{ const s=localStorage.getItem(key); return s?JSON.parse(s):init; }catch{return init;} });
  useEffect(()=>{ localStorage.setItem(key, JSON.stringify(v)); },[key,v]);
  return [v,setV] as const;
}

// WebAudio 生成提示音（避免静态音频文件）
const playBeep = (hz:number, ms:number=250)=>{
  try{
    const C:any = (window as any).AudioContext || (window as any).webkitAudioContext;
    if(!C) return;
    const ctx = new C();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type='sine'; osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime+0.02);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    setTimeout(()=>{ gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.05); setTimeout(()=>{ osc.stop(); ctx.close(); }, 80); }, ms);
  }catch{}
};

export default function App(){
  const [tab,setTab]=useState<"timer"|"todo"|"stats"|"settings">("timer");
  const [settings,setSettings]=useLocalStorage(LS.settings, DEFAULT);
  const [tasks,setTasks]=useLocalStorage<Task[]>(LS.tasks, []);
  const [log,setLog]=useLocalStorage<Log[]>(LS.log, []);
  const [streak,setStreak]=useLocalStorage(LS.streak, { current:0, best:0, lastDate:"" });

  const [mode,setMode]=useState<"work"|"short"|"long">("work");
  const [left,setLeft]=useState(settings.workMin*60);
  const [run,setRun]=useState(false);
  const [activeId,setActiveId]=useState<string|undefined>(undefined);
  const timer=useRef<any>(null);
  const activeTask = tasks.find(t=>t.id===activeId);

  // 计时
  useEffect(()=>{ if(!run) return; timer.current=setInterval(()=>{
    setLeft(p=>{ if(p<=1){ clearInterval(timer.current); setRun(false); onPhaseDone(); return 0; } return p-1; });
  },1000); return ()=>clearInterval(timer.current); },[run]);

  useEffect(()=>{ setLeft(mode==="work"?settings.workMin*60 : mode==="short"?settings.shortMin*60 : settings.longMin*60); },[mode,settings.workMin,settings.shortMin,settings.longMin]);

  // 权限
  useEffect(()=>{ (async()=>{
    try{
      if(Capacitor.isNativePlatform()) await LocalNotifications.requestPermissions();
      else if("Notification" in window && (Notification as any).permission==="default") (Notification as any).requestPermission?.();
    }catch{}
  })(); },[]);

  // 连续打卡（每天 ≥1 番茄）
  useEffect(()=>{
    const d=today();
    if(log.some(x=>x.date===d)){
      if(streak.lastDate===d) return;
      const y=new Date(); y.setDate(y.getDate()-1);
      const ymd = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
      const cont = streak.lastDate===ymd || streak.lastDate===d;
      const cur = cont? streak.current : 0;
      const next = cur + 1;
      setStreak({ current:next, best:Math.max(streak.best,next), lastDate:d });
    }
  }, [log]);

  const notify = async (title:string, body:string)=>{
    try{
      if(!Capacitor.isNativePlatform() && "Notification" in window && (Notification as any).permission==="granted"){ new Notification(title,{ body }); return; }
      if(Capacitor.isNativePlatform()){
        await LocalNotifications.schedule({ notifications:[{ id: Date.now()%100000|0, title, body, schedule:{ at: new Date(Date.now()+200) } }] });
      }
    }catch{}
  };

  const onPhaseDone=()=>{
    if(mode==="work"){
      if(activeTask){
        setTasks(p=>p.map(t=>t.id===activeTask.id?{...t,donePoms:(t.donePoms||0)+1, completed:(t.donePoms+1)>=t.est || t.completed}:t));
      }
      setLog(p=>[...p,{ id:uid(), date:today(), seconds:settings.workMin*60, category:activeTask?.category||"正能量", taskId:activeTask?.id }]);
      if(settings.sound) playBeep(880, 280);
      notify("正能量番茄完成","深呼吸，开始休息吧～");
      const nextIsLong = ((activeTask?.donePoms||0)+1) % settings.longEvery === 0;
      setMode(nextIsLong?"long":"short"); setLeft(nextIsLong?settings.longMin*60:settings.shortMin*60);
      if(settings.autoNext) setRun(true);
    }else{
      if(settings.sound) playBeep(660, 280);
      notify("休息结束","正能量满满，继续冲！");
      setMode("work"); setLeft(settings.workMin*60); if(settings.autoNext) setRun(true);
    }
  };

  const addTask=(title:string, cat:string, est:number)=>{
    if(!title.trim()) return;
    const t:Task={ id:uid(), title:title.trim(), category:cat||"正能量", est:Math.max(1,Number(est)||1), donePoms:0, completed:false, createdAt:new Date().toISOString() };
    setTasks(p=>[t,...p]); setActiveId(t.id);
  };

  // 统计
  const stats = useMemo(()=>{
    const map:Record<string,number>={}; for(const l of log) map[l.date]=(map[l.date]||0)+1;
    const d=new Date(); const last7:string[]=[]; for(let i=6;i>=0;i--){ const x=new Date(d); x.setDate(x.getDate()-i); const s=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; last7.push(s); }
    const series = last7.map(k=>({ date:k, value: map[k]||0 }));
    return { series, total: log.length, todays: map[today()]||0 };
  },[log]);

  return (
    <div className="wrap">
      <div className="title">
        <h2 style={{margin:0}}>正能量打卡</h2>
        <span className="badge">今天 {stats.todays} 🍅 · 连续 {streak.current} 天 · 目标 {settings.goalPerDay} 🍅/天</span>
      </div>

      <div className="tabs">
        <button className={"tab "+(tab==='timer'?'active':'')} onClick={()=>setTab('timer')}>正能量计时</button>
        <button className={"tab "+(tab==='todo'?'active':'')} onClick={()=>setTab('todo')}>正能量待办</button>
        <button className={"tab "+(tab==='stats'?'active':'')} onClick={()=>setTab('stats')}>正能量统计</button>
        <button className={"tab "+(tab==='settings'?'active':'')} onClick={()=>setTab('settings')}>正能量设置</button>
      </div>

      {tab==='timer' && <TimerCard {...{mode,left,run,setRun,setMode,settings,activeTask,setActiveId,tasks}}/>}
      {tab==='todo' && <TodoCard tasks={tasks} setTasks={setTasks} setActiveId={setActiveId} addTask={addTask}/>}
      {tab==='stats' && <StatsCard stats={stats} goal={settings.goalPerDay} streak={streak.best}/>}
      {tab==='settings' && <SettingsCard settings={settings} setSettings={setSettings}/>}
    </div>
  );
}

function TimerCard({mode,left,run,setRun,setMode,settings,activeTask,setActiveId,tasks}:{mode:"work"|"short"|"long";left:number;run:boolean;setRun:any;setMode:any;settings:any;activeTask:any;setActiveId:any;tasks:any[]}) {
  return (
    <div className="card" style={{padding:16}}>
      <div className="row" style={{justifyContent:"space-between"}}>
        <div><div className="muted">当前模式</div><h3 style={{margin:"6px 0"}}>{mode==="work"?"专注番茄":"休息"}</h3></div>
        <select value={mode} onChange={e=>{setRun(false); setMode(e.target.value as any)}}>
          <option value="work">专注</option><option value="short">短休</option><option value="long">长休</option>
        </select>
      </div>
      <div style={{textAlign:"center",fontSize:72,fontWeight:800,letterSpacing:1,margin:"16px 0"}}>{mmss(left)}</div>
      <div className="row" style={{justifyContent:"center"}}>
        <button className="btn" onClick={()=>setRun((r:boolean)=>!r)}>{run?"暂停":"开始"}</button>
        <button className="btn secondary" onClick={()=>{ setRun(false); setMode('work'); }}>重置</button>
      </div>
      <div style={{marginTop:16}} className="row">
        <div className="muted">当前任务：</div>
        <select value={activeTask?.id||""} onChange={e=>setActiveId(e.target.value||undefined)}>
          <option value="">（不绑定任务）</option>
          {tasks.map(t=>(<option key={t.id} value={t.id}>{t.title}（已 {t.donePoms||0}/{t.est} 🍅）</option>))}
        </select>
      </div>
    </div>
  );
}

function TodoCard({tasks,setTasks,setActiveId,addTask}:{tasks:any[];setTasks:any;setActiveId:any;addTask:(t:string,c:string,e:number)=>void}){
  const [title,setTitle]=useState(""); const [cat,setCat]=useState("学习"); const [est,setEst]=useState(1);
  const del=(id:string)=>setTasks((p:any[])=>p.filter(x=>x.id!==id));
  const toggle=(id:string)=>setTasks((p:any[])=>p.map(x=>x.id===id?{...x,completed:!x.completed}:x));
  return (
    <div className="grid">
      <div className="card" style={{padding:16}}>
        <h3>添加正能量任务</h3>
        <div className="row">
          <input placeholder="例如：英语单词 / 深蹲 3 组" value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') addTask(title,cat,est); }}/>
          <select value={cat} onChange={e=>setCat(e.target.value)}><option>学习</option><option>健身</option><option>其他</option></select>
          <input type="number" min={1} value={est} onChange={e=>setEst(Math.max(1,Number(e.target.value)||1))} style={{width:80}}/>
          <button className="btn" onClick={()=>addTask(title,cat,est)}>添加</button>
        </div>
      </div>

      <div className="card" style={{padding:16}}>
        <h3>任务列表</h3>
        <div className="list">
          {tasks.map(t=>(
            <div key={t.id} className="item">
              <div>
                <div style={{fontWeight:600, textDecoration:t.completed?'line-through':'none'}}>{t.title} <span className="badge">{t.category}</span></div>
                <div className="muted">预计 {t.est} 🍅 · 已完成 {t.donePoms||0} 🍅</div>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={()=>setActiveId(t.id)}>绑定</button>
                <button className="btn secondary" onClick={()=>toggle(t.id)}>{t.completed?'未完成':'完成'}</button>
                <button className="btn ghost" onClick={()=>del(t.id)}>删除</button>
              </div>
            </div>
          ))}
          {tasks.length===0 && <div className="muted">暂无任务，添加一个开启你的正能量吧～</div>}
        </div>
      </div>
    </div>
  );
}

function StatsCard({stats,goal,streak}:{stats:any;goal:number;streak:number}){
  const percent = Math.min(100, Math.round((stats.todays / goal) * 100));
  const max = Math.max(1, ...stats.series.map((s:any)=>s.value));
  const W=620, H=180, P=24;
  const step = (W-2*P)/Math.max(1,stats.series.length-1);
  const path = stats.series.map((s:any,i:number)=>{
    const x = P + i*step;
    const y = H - P - (s.value/max)*(H-2*P);
    return `${i===0?'M':'L'} ${x} ${y}`;
  }).join(' ');
  return (
    <div className="card" style={{padding:16}}>
      <h3>正能量统计</h3>
      <div className="kpi">
        <div className="card" style={{padding:12}}><div className="muted">今日番茄</div><h2 style={{margin:"6px 0"}}>{stats.todays}</h2></div>
        <div className="card" style={{padding:12}}><div className="muted">累计番茄</div><h2 style={{margin:"6px 0"}}>{stats.total}</h2></div>
        <div className="card" style={{padding:12}}><div className="muted">历史最佳连击</div><h2 style={{margin:"6px 0"}}>{streak} 天</h2></div>
      </div>
      <div style={{marginTop:16}}>
        <div className="muted">本日目标进度（{stats.todays}/{goal}）</div>
        <div className="progress"><div style={{width: percent+'%'}}></div></div>
      </div>
      <div style={{marginTop:16}}>
        <div className="muted">最近 7 天趋势（番茄数）</div>
        <svg width={W} height={H} style={{maxWidth:"100%"}}>
          <rect x="0" y="0" width={W} height={H} fill="#fff" rx="12" stroke="#e5e7eb"/>
          <path d={path} fill="none" stroke="#0ea5e9" strokeWidth="3"/>
          {stats.series.map((s:any,i:number)=>{ const x=P+i*step; const y=H-P-(s.value/max)*(H-2*P); return <circle key={i} cx={x} cy={y} r={3} fill="#0ea5e9"/>; })}
          {stats.series.map((s:any,i:number)=>{ const x=P+i*step; return <text key={'t'+i} x={x} y={H-8} fontSize="10" textAnchor="middle" fill="#64748b">{s.date.slice(5)}</text>; })}
        </svg>
      </div>
    </div>
  );
}

function SettingsCard({settings,setSettings}:{settings:any;setSettings:any}){
  const change=(k:string,v:any)=>setSettings((p:any)=>({...p,[k]:v}));
  return (
    <div className="grid">
      <div className="card" style={{padding:16}}>
        <h3>正能量时长设置</h3>
        <div className="row"><label>专注(分)：</label><input type="number" min={1} value={settings.workMin} onChange={e=>change('workMin', clamp(Number(e.target.value)||25,1,180))}/></div>
        <div className="row"><label>短休(分)：</label><input type="number" min={1} value={settings.shortMin} onChange={e=>change('shortMin', clamp(Number(e.target.value)||5,1,60))}/></div>
        <div className="row"><label>长休(分)：</label><input type="number" min={1} value={settings.longMin} onChange={e=>change('longMin', clamp(Number(e.target.value)||15,1,120))}/></div>
        <div className="row"><label>长休周期：</label><input type="number" min={2} value={settings.longEvery} onChange={e=>change('longEvery', clamp(Number(e.target.value)||4,2,12))}/></div>
      </div>

      <div className="card" style={{padding:16}}>
        <h3>正能量提醒</h3>
        <div className="row"><label><input type="checkbox" checked={settings.autoNext} onChange={e=>change('autoNext', e.target.checked)}/> 自动开始下一阶段</label></div>
        <div className="row"><label><input type="checkbox" checked={settings.sound} onChange={e=>change('sound', e.target.checked)}/> 声音提示</label></div>
      </div>

      <div className="card" style={{padding:16}}>
        <h3>目标与数据</h3>
        <div className="row"><label>目标番茄/天：</label><input type="number" min={1} value={settings.goalPerDay} onChange={e=>change('goalPerDay', clamp(Number(e.target.value)||6,1,48))}/></div>
        <div className="row" style={{marginTop:12, gap:8}}>
          <button className="btn secondary" onClick={()=>{
            const data = JSON.stringify({
              settings,
              tasks: JSON.parse(localStorage.getItem('znldk_tasks_v2') || '[]'),
              log:   JSON.parse(localStorage.getItem('znldk_log_v2')   || '[]')
            }, null, 2);
            const blob = new Blob([data],{type:'application/json'});
            const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='正能量打卡-备份.json'; a.click();
          }}>导出备份</button>
          <label className="btn ghost" style={{position:'relative'}}>
            导入备份
            <input type="file" accept="application/json" style={{position:'absolute',inset:0,opacity:0}} onChange={e=>{
              const f=e.target.files?.[0]; if(!f) return;
              const rd=new FileReader(); rd.onload=()=>{
                try{
                  const obj=JSON.parse(String(rd.result||'{}'));
                  if(obj.settings) localStorage.setItem('znldk_settings_v2', JSON.stringify(obj.settings));
                  if(obj.tasks)    localStorage.setItem('znldk_tasks_v2',    JSON.stringify(obj.tasks));
                  if(obj.log)      localStorage.setItem('znldk_log_v2',      JSON.stringify(obj.log));
                  alert('导入成功，刷新后生效'); location.reload();
                }catch{ alert('导入失败，文件格式不正确'); }
              }; rd.readAsText(f);
            }}/>
          </label>
          <button className="btn ghost" onClick={()=>{ if(confirm('确定清空所有数据？')){ localStorage.clear(); location.reload(); }}}>清空数据</button>
        </div>
      </div>
    </div>
  );
}