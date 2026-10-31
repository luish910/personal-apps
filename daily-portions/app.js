'use strict';

const FOODS = [
  {id:'protein', name:'Protein', icon:'◉', defaultGoal:7},
  {id:'cereals', name:'Cereals', icon:'◇', defaultGoal:7},
  {id:'dairy', name:'Dairy', icon:'◻', defaultGoal:3},
  {id:'fruit', name:'Fruit', icon:'●', defaultGoal:2},
  {id:'fats', name:'Fats', icon:'◈', defaultGoal:1},
  {id:'vegetables', name:'Vegetables', icon:'✳', defaultGoal:2}
];
const GOALS_KEY = 'daily-portions-goals-v1';
const LOG_KEY = 'daily-portions-log-v1';
const TEST_LOG_KEY = 'daily-portions-test-log-v1';
const STEP_KEY = 'daily-portions-step-v1';

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
const actualToday = () => localDate();
let simulatedDate = null;
let step = Number(localStorage.getItem(STEP_KEY)) || 1;
if (![1,0.5,0.25].includes(step)) step=1;

function readJSON(key, fallback) {
  try {const value=JSON.parse(localStorage.getItem(key));return value && typeof value==='object'?value:fallback;}
  catch {return fallback;}
}
function validAmount(x) {return typeof x==='number' && Number.isFinite(x) && x>=0 && Math.round(x*4)===x*4;}
function cleanValues(obj, fallback) {
  return Object.fromEntries(FOODS.map(f=>[f.id,validAmount(obj?.[f.id])?obj[f.id]:fallback(f)]));
}
let goals=cleanValues(readJSON(GOALS_KEY,{}),f=>f.defaultGoal);
let log={date:'',values:{}};
const activeDate=()=>simulatedDate ?? actualToday();
const storageKey=()=>simulatedDate?TEST_LOG_KEY:LOG_KEY;
function loadDay() {
  const date=activeDate();
  const saved=readJSON(storageKey(),{});
  log={date,values:cleanValues(saved.date===date?saved.values:{},()=>0)};
  saveDay();
}
function saveDay() {localStorage.setItem(storageKey(),JSON.stringify(log));}
function ensureToday() {
  if(log.date!==activeDate() || currentKey!==storageKey()){
    currentKey=storageKey();loadDay();render();
  }
}
let currentKey=storageKey();
loadDay();

const grid=document.querySelector('#foodGrid');
const goalsPanel=document.querySelector('#goalsPanel');
const fmt=n=>String(Number(n.toFixed(2)));
function render() {
  const date=activeDate();
  const [y,m,d]=date.split('-').map(Number);
  document.querySelector('#dateLabel').textContent=new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const status=document.querySelector('#testStatus');
  status.textContent=simulatedDate?`Testing ${simulatedDate} · Real entries are untouched.`:'Using the actual device date.';
  const label=document.querySelector('#dateLabel');
  label.classList.toggle('test-banner',Boolean(simulatedDate));
  document.querySelectorAll('.step').forEach(b=>{const isActive=Number(b.dataset.step)===step;b.classList.toggle('selected',isActive);b.setAttribute('aria-pressed',String(isActive));});
  grid.innerHTML=FOODS.map(f=>{
    const consumed=log.values[f.id], goal=goals[f.id], left=goal-consumed;
    const mode=left<0?'over':left===0?'complete':'left';
    const progress=goal===0?(consumed?100:0):Math.min(100,consumed/goal*100);
    return `<article class="food-card">
      <div class="food-name"><span class="food-icon" aria-hidden="true">${f.icon}</span><span>${f.name}</span></div>
      <div><div class="balance ${mode}">${left<0?'+':''}${fmt(Math.abs(left))}</div><div class="status">${mode==='over'?'over':mode==='complete'?'complete':'left'}</div></div>
      <div class="progress" aria-hidden="true"><div class="${mode}" style="width:${progress}%"></div></div>
      <div class="fraction">${fmt(consumed)} / ${fmt(goal)}</div>
      <div class="controls"><button type="button" class="subtract" data-food="${f.id}" data-delta="-1" ${consumed===0?'disabled':''} aria-label="Remove ${fmt(step)} ${f.name} portions">−</button><button type="button" class="add" data-food="${f.id}" data-delta="1" aria-label="Add ${fmt(step)} ${f.name} portions">+</button></div>
    </article>`;
  }).join('');
  goalsPanel.innerHTML=FOODS.map(f=>`<div class="goal-row"><span>${f.name}</span><div class="goal-controls"><button type="button" data-goal="${f.id}" data-change="-1" aria-label="Decrease ${f.name} goal">−</button><span class="goal-value">${fmt(goals[f.id])}</span><button type="button" data-goal="${f.id}" data-change="1" aria-label="Increase ${f.name} goal">+</button></div></div>`).join('');
}

document.querySelectorAll('.step').forEach(b=>b.addEventListener('click',()=>{step=Number(b.dataset.step);localStorage.setItem(STEP_KEY,String(step));render();}));
grid.addEventListener('click', event => {
  const button = event.target.closest('button[data-food]');
  if (!button) return;

  ensureToday();

  const id = button.dataset.food;
  const direction = Number(button.dataset.delta);

  log.values[id] = Math.max(
    0,
    Math.round((log.values[id] + direction * step) * 4) / 4
  );

  saveDay();

  // Reset the portion selector to 1 after each entry.
  if (step !== 1) {
    step = 1;
    localStorage.setItem(STEP_KEY, '1');
  }

  render();
});
document.querySelector('#toggleGoals').addEventListener('click',()=>{
  const hidden=goalsPanel.classList.toggle('hidden');
  document.querySelector('#toggleGoals').setAttribute('aria-expanded',String(!hidden));
  document.querySelector('#toggleGoals').textContent=hidden?'⚙ Edit daily goals':'⚙ Close goal settings';
});
goalsPanel.addEventListener('click',event=>{
  const button=event.target.closest('button[data-goal]');if(!button)return;
  const id=button.dataset.goal;
  //goals[id]=Math.max(0,Math.round((goals[id]+Number(button.dataset.change)*0.25)*4)/4);
  goals[id]=Math.max(0,goals[id]+Number(button.dataset.change));
  localStorage.setItem(GOALS_KEY,JSON.stringify(goals));render();
});
document.querySelector('#testTomorrow').addEventListener('click',()=>{
  const next=new Date();next.setHours(12,0,0,0);next.setDate(next.getDate()+1);
  simulatedDate=localDate(next);currentKey=storageKey();loadDay();render();
});
document.querySelector('#testToday').addEventListener('click',()=>{
  simulatedDate=null;currentKey=storageKey();loadDay();render();
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)ensureToday();});
window.addEventListener('pageshow',ensureToday);
window.addEventListener('focus',ensureToday);
setInterval(ensureToday,60000);
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
render();
