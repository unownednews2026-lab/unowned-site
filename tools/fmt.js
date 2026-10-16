/* Formats a story JSON file in the house style (one event/source per line). Usage: node tools/fmt.js content/stories/<file>.json */
const fs=require("fs");const p=process.argv[2];const s=JSON.parse(fs.readFileSync(p,"utf8"));
function inl(v){if(Array.isArray(v))return "["+v.map(inl).join(", ")+"]";if(v&&typeof v==="object")return "{ "+Object.entries(v).map(([k,x])=>JSON.stringify(k)+": "+inl(x)).join(", ")+" }";return JSON.stringify(v);}
function f(v,d){const pad="  ".repeat(d+1),end="  ".repeat(d);
 if(d>=2)return inl(v);
 if(Array.isArray(v))return v.length?"[\n"+v.map(x=>pad+f(x,d+1)).join(",\n")+"\n"+end+"]":"[]";
 if(v&&typeof v==="object")return "{\n"+Object.entries(v).map(([k,x])=>pad+JSON.stringify(k)+": "+f(x,d+1)).join(",\n")+"\n"+end+"}";
 return JSON.stringify(v);}
fs.writeFileSync(p,(f(s,0)+"\n").replace(/"lat": 18.4, /g,"\"lat\": 18.40, "));
