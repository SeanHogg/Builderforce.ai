import{p as tt}from"./chunk-chunk-JWPE2WC7.js";import{g as et,s as at,a as rt,b as it,p as nt,o as ot,_ as l,l as E,c as st,B as lt,F as ct,G as dt,H as N,d as gt,q as ht,I as pt,D as ft}from"./chunk-mermaid.core.js";import{p as ut}from"./chunk-cynefin-OW5HDTMX.js";import{av as mt}from"./index.js";import"./chunk-d3-selection.js";var vt=ft.pie,R={sections:new Map,showData:!1},T=R.sections,F=R.showData,St=structuredClone(vt),xt=l(()=>structuredClone(St),"getConfig"),wt=l(()=>{T=new Map,F=R.showData,ht()},"clear"),$t=l(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);T.has(t)||(T.set(t,a),E.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),Ct=l(()=>T,"getSections"),Dt=l(t=>{F=t},"setShowData"),yt=l(()=>F,"getShowData"),U={getConfig:xt,clear:wt,setDiagramTitle:ot,getDiagramTitle:nt,setAccTitle:it,getAccTitle:rt,setAccDescription:at,getAccDescription:et,addSection:$t,getSections:Ct,setShowData:Dt,getShowData:yt},Tt=l((t,a)=>{tt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),bt={parse:l(async t=>{const a=await ut("pie",t);E.debug(a),Tt(a,U)},"parse")},At=l(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),_t=At,kt=l(t=>{const a=[...t.values()].reduce((o,m)=>o+m,0),H=[...t.entries()].map(([o,m])=>({label:o,value:m})).filter(o=>o.value/a*100>=1);return pt().value(o=>o.value).sort(null)(H)},"createPieArcs"),zt=l((t,a,H,L)=>{E.debug(`rendering pie chart
`+t);const o=L.db,m=st(),p=lt(o.getConfig(),m.pie),W=40,i=18,c=4,$=450,S=$,b=ct(a),C=b.append("g");C.attr("transform","translate("+S/2+","+$/2+")");const{themeVariables:n}=m;let[G]=dt(n.pieOuterStrokeWidth);G??=2;const q=p.legendPosition,M=p.textPosition,V=p.donutHole>0&&p.donutHole<=.9?p.donutHole:0,f=Math.min(S,$)/2-W,X=N().innerRadius(V*f).outerRadius(f),Z=N().innerRadius(f*M).outerRadius(f*M),x=C.append("g");x.append("circle").attr("cx",0).attr("cy",0).attr("r",f+G/2).attr("class","pieOuterCircle");const D=o.getSections(),j=kt(D),J=[n.pie1,n.pie2,n.pie3,n.pie4,n.pie5,n.pie6,n.pie7,n.pie8,n.pie9,n.pie10,n.pie11,n.pie12];let A=0;D.forEach(e=>{A+=e});const O=j.filter(e=>(e.data.value/A*100).toFixed(0)!=="0"),_=mt(J).domain([...D.keys()]);x.selectAll("mySlices").data(O).enter().append("path").attr("d",X).attr("fill",e=>_(e.data.label)).attr("class",e=>{let r="pieCircle";return p.highlightSlice==="hover"?r+=" highlightedOnHover":p.highlightSlice===e.data.label&&(r+=" highlighted"),r}),x.selectAll("mySlices").data(O).enter().append("text").text(e=>(e.data.value/A*100).toFixed(0)+"%").attr("transform",e=>"translate("+Z.centroid(e)+")").style("text-anchor","middle").attr("class","slice");const K=C.append("text").text(o.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),w=[...D.entries()].map(([e,r])=>({label:e,value:r})),u=C.selectAll(".legend").data(w).enter().append("g").attr("class","legend");u.append("rect").attr("width",i).attr("height",i).style("fill",e=>_(e.label)).style("stroke",e=>_(e.label)),u.append("text").attr("x",i+c).attr("y",i-c).text(e=>o.getShowData()?`${e.label} [${e.value}]`:e.label);const v=Math.max(...u.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0));let y=$,k=S+W;const s=i+c,z=w.length*s;switch(q){case"center":u.attr("transform",(e,r)=>{const d=s*w.length/2,g=-v/2-(i+c),h=r*s-d;return"translate("+g+","+h+")"});break;case"top":y+=z,u.attr("transform",(e,r)=>{const d=f,g=-v/2-(i+c),h=r*s-d;return`translate(${g}, ${h})`}),x.attr("transform",()=>`translate(0, ${z+s})`);break;case"bottom":y+=z,u.attr("transform",(e,r)=>{const d=-f-s,g=-v/2-(i+c),h=r*s-d;return"translate("+g+","+h+")"});break;case"left":k+=i+c+v,u.attr("transform",(e,r)=>{const d=s*w.length/2,g=-f-(i+c),h=r*s-d;return"translate("+g+","+h+")"}),x.attr("transform",()=>`translate(${v+i+c}, 0)`);break;default:k+=i+c+v,u.attr("transform",(e,r)=>{const d=s*w.length/2,g=12*i,h=r*s-d;return"translate("+g+","+h+")"});break}const P=K.node()?.getBoundingClientRect().width??0,Q=S/2-P/2,Y=S/2+P/2,B=Math.min(0,Q),I=Math.max(k,Y)-B;b.attr("viewBox",`${B} 0 ${I} ${y}`),gt(b,y,I,p.useMaxWidth)},"draw"),Et={draw:zt},Mt={parser:bt,db:U,renderer:Et,styles:_t};export{Mt as diagram};
