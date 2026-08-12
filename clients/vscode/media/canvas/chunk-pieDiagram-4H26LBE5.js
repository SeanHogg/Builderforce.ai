import{X as y,a0 as R,b1 as Q,g as Y,s as tt,a as et,b as at,p as rt,o as nt,_ as p,l as F,c as it,E as st,H as ot,M as lt,d as ct,y as ut,F as pt}from"./chunk-mermaid.core.js";import{p as dt}from"./chunk-chunk-4BX2VUAB.js";import{p as gt}from"./chunk-wardley-L42UT6IY.js";import"./chunk-transform.js";import{d as _}from"./chunk-arc.js";import{o as ft}from"./chunk-ordinal.js";import"./index.js";import"./chunk-init.js";function ht(t,a){return a<t?-1:a>t?1:a>=t?0:NaN}function mt(t){return t}function vt(){var t=mt,a=ht,f=null,S=y(0),s=y(R),d=y(0);function o(e){var n,l=(e=Q(e)).length,g,h,v=0,c=new Array(l),i=new Array(l),x=+S.apply(this,arguments),w=Math.min(R,Math.max(-R,s.apply(this,arguments)-x)),m,D=Math.min(Math.abs(w)/l,d.apply(this,arguments)),$=D*(w<0?-1:1),u;for(n=0;n<l;++n)(u=i[c[n]=n]=+t(e[n],n,e))>0&&(v+=u);for(a!=null?c.sort(function(A,C){return a(i[A],i[C])}):f!=null&&c.sort(function(A,C){return f(e[A],e[C])}),n=0,h=v?(w-l*$)/v:0;n<l;++n,x=m)g=c[n],u=i[g],m=x+(u>0?u*h:0)+$,i[g]={data:e[g],index:n,value:u,startAngle:x,endAngle:m,padAngle:D};return i}return o.value=function(e){return arguments.length?(t=typeof e=="function"?e:y(+e),o):t},o.sortValues=function(e){return arguments.length?(a=e,f=null,o):a},o.sort=function(e){return arguments.length?(f=e,a=null,o):f},o.startAngle=function(e){return arguments.length?(S=typeof e=="function"?e:y(+e),o):S},o.endAngle=function(e){return arguments.length?(s=typeof e=="function"?e:y(+e),o):s},o.padAngle=function(e){return arguments.length?(d=typeof e=="function"?e:y(+e),o):d},o}var xt=pt.pie,W={sections:new Map,showData:!1},T=W.sections,z=W.showData,yt=structuredClone(xt),St=p(()=>structuredClone(yt),"getConfig"),wt=p(()=>{T=new Map,z=W.showData,ut()},"clear"),At=p(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);T.has(t)||(T.set(t,a),F.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),Ct=p(()=>T,"getSections"),Dt=p(t=>{z=t},"setShowData"),$t=p(()=>z,"getShowData"),V={getConfig:St,clear:wt,setDiagramTitle:nt,getDiagramTitle:rt,setAccTitle:at,getAccTitle:et,setAccDescription:tt,getAccDescription:Y,addSection:At,getSections:Ct,setShowData:Dt,getShowData:$t},Tt=p((t,a)=>{dt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),bt={parse:p(async t=>{const a=await gt("pie",t);F.debug(a),Tt(a,V)},"parse")},Et=p(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
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
`,"getStyles"),Mt=Et,kt=p(t=>{const a=[...t.values()].reduce((s,d)=>s+d,0),f=[...t.entries()].map(([s,d])=>({label:s,value:d})).filter(s=>s.value/a*100>=1);return vt().value(s=>s.value).sort(null)(f)},"createPieArcs"),Rt=p((t,a,f,S)=>{var P;F.debug(`rendering pie chart
`+t);const s=S.db,d=it(),o=st(s.getConfig(),d.pie),e=40,n=18,l=4,g=450,h=g,v=ot(a),c=v.append("g");c.attr("transform","translate("+h/2+","+g/2+")");const{themeVariables:i}=d;let[x]=lt(i.pieOuterStrokeWidth);x??(x=2);const w=o.textPosition,m=Math.min(h,g)/2-e,D=_().innerRadius(0).outerRadius(m),$=_().innerRadius(m*w).outerRadius(m*w);c.append("circle").attr("cx",0).attr("cy",0).attr("r",m+x/2).attr("class","pieOuterCircle");const u=s.getSections(),A=kt(u),C=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let b=0;u.forEach(r=>{b+=r});const G=A.filter(r=>(r.data.value/b*100).toFixed(0)!=="0"),E=ft(C).domain([...u.keys()]);c.selectAll("mySlices").data(G).enter().append("path").attr("d",D).attr("fill",r=>E(r.data.label)).attr("class","pieCircle"),c.selectAll("mySlices").data(G).enter().append("text").text(r=>(r.data.value/b*100).toFixed(0)+"%").attr("transform",r=>"translate("+$.centroid(r)+")").style("text-anchor","middle").attr("class","slice");const U=c.append("text").text(s.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),L=[...u.entries()].map(([r,k])=>({label:r,value:k})),M=c.selectAll(".legend").data(L).enter().append("g").attr("class","legend").attr("transform",(r,k)=>{const I=n+l,q=I*L.length/2,J=12*n,K=k*I-q;return"translate("+J+","+K+")"});M.append("rect").attr("width",n).attr("height",n).style("fill",r=>E(r.label)).style("stroke",r=>E(r.label)),M.append("text").attr("x",n+l).attr("y",n-l).text(r=>s.getShowData()?`${r.label} [${r.value}]`:r.label);const X=Math.max(...M.selectAll("text").nodes().map(r=>(r==null?void 0:r.getBoundingClientRect().width)??0)),j=h+e+n+l+X,N=((P=U.node())==null?void 0:P.getBoundingClientRect().width)??0,H=h/2-N/2,Z=h/2+N/2,B=Math.min(0,H),O=Math.max(j,Z)-B;v.attr("viewBox",`${B} 0 ${O} ${g}`),ct(v,g,O,o.useMaxWidth)},"draw"),Ft={draw:Rt},_t={parser:bt,db:V,renderer:Ft,styles:Mt};export{_t as diagram};
