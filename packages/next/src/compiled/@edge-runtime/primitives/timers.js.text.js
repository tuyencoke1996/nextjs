module.exports = "\"use strict\";var a=Object.defineProperty,s=Object.getOwnPropertyDescriptor,i=Object.getOwnPropertyNames,u=Object.prototype.hasOwnProperty,l=(t,e)=>{for(var r in e)a(t,r,{get:e[r],enumerable:!0})},y=(t,e,r,p)=>{if(e&&typeof e==\"object\"||typeof e==\"function\")for(let o of i(e))!u.call(t,o)&&o!==r&&a(t,o,{get:()=>e[o],enumerable:!(p=s(e,o))||p.enumerable});return t},v=t=>y(a({},\"__esModule\",{value:!0}),t),n={};l(n,{setInterval:()=>m,setTimeout:()=>_});module.exports=v(n);var _=new Proxy(setTimeout,{apply:(t,e,r)=>Reflect.apply(t,e,r)[Symbol.toPrimitive]()}),m=new Proxy(setInterval,{apply:(t,e,r)=>Reflect.apply(t,e,r)[Symbol.toPrimitive]()});\n"