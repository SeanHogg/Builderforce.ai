import{g as Ae,s as Oe,p as We,o as Ne,a as Pe,b as Re,_ as c,c as ft,d as ze,ba as j,l as ot,j as Ve,i as He,y as Be,u as qe}from"./chunk-mermaid.core.js";import{o as $t}from"./index.js";import{R as ye,r as Ge,e as ge,f as pe,C as ve,n as Ft,h as je,s as bt}from"./chunk-transform.js";import{t as Xe,a as Ue,b as se,c as ie,d as Ze,e as Qe,f as Ke,g as Je,h as ts,i as es,j as ss,k as re,l as ne,m as ae,s as oe,n as ce,o as is}from"./chunk-time.js";import{m as rs,a as ns}from"./chunk-min.js";import{l as as}from"./chunk-linear.js";import"./chunk-continuous.js";import"./chunk-init.js";import"./chunk-defaultLocale.js";const os=Math.PI/180,cs=180/Math.PI,Et=18,xe=.96422,Te=1,be=.82521,we=4/29,ht=6/29,_e=3*ht*ht,ls=ht*ht*ht;function De(t){if(t instanceof et)return new et(t.l,t.a,t.b,t.opacity);if(t instanceof it)return Ce(t);t instanceof ye||(t=Ge(t));var s=Nt(t.r),r=Nt(t.g),i=Nt(t.b),a=At((.2225045*s+.7168786*r+.0606169*i)/Te),k,y;return s===r&&r===i?k=y=a:(k=At((.4360747*s+.3850649*r+.1430804*i)/xe),y=At((.0139322*s+.0971045*r+.7141733*i)/be)),new et(116*a-16,500*(k-a),200*(a-y),t.opacity)}function us(t,s,r,i){return arguments.length===1?De(t):new et(t,s,r,i??1)}function et(t,s,r,i){this.l=+t,this.a=+s,this.b=+r,this.opacity=+i}ge(et,us,pe(ve,{brighter(t){return new et(this.l+Et*(t??1),this.a,this.b,this.opacity)},darker(t){return new et(this.l-Et*(t??1),this.a,this.b,this.opacity)},rgb(){var t=(this.l+16)/116,s=isNaN(this.a)?t:t+this.a/500,r=isNaN(this.b)?t:t-this.b/200;return s=xe*Ot(s),t=Te*Ot(t),r=be*Ot(r),new ye(Wt(3.1338561*s-1.6168667*t-.4906146*r),Wt(-.9787684*s+1.9161415*t+.033454*r),Wt(.0719453*s-.2289914*t+1.4052427*r),this.opacity)}}));function At(t){return t>ls?Math.pow(t,1/3):t/_e+we}function Ot(t){return t>ht?t*t*t:_e*(t-we)}function Wt(t){return 255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055)}function Nt(t){return(t/=255)<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)}function ds(t){if(t instanceof it)return new it(t.h,t.c,t.l,t.opacity);if(t instanceof et||(t=De(t)),t.a===0&&t.b===0)return new it(NaN,0<t.l&&t.l<100?0:NaN,t.l,t.opacity);var s=Math.atan2(t.b,t.a)*cs;return new it(s<0?s+360:s,Math.sqrt(t.a*t.a+t.b*t.b),t.l,t.opacity)}function Rt(t,s,r,i){return arguments.length===1?ds(t):new it(t,s,r,i??1)}function it(t,s,r,i){this.h=+t,this.c=+s,this.l=+r,this.opacity=+i}function Ce(t){if(isNaN(t.h))return new et(t.l,0,0,t.opacity);var s=t.h*os;return new et(t.l,Math.cos(s)*t.c,Math.sin(s)*t.c,t.opacity)}ge(it,Rt,pe(ve,{brighter(t){return new it(this.h,this.c,this.l+Et*(t??1),this.opacity)},darker(t){return new it(this.h,this.c,this.l-Et*(t??1),this.opacity)},rgb(){return Ce(this).rgb()}}));function fs(t){return function(s,r){var i=t((s=Rt(s)).h,(r=Rt(r)).h),a=Ft(s.c,r.c),k=Ft(s.l,r.l),y=Ft(s.opacity,r.opacity);return function(x){return s.h=i(x),s.c=a(x),s.l=k(x),s.opacity=y(x),s+""}}}const hs=fs(je);var wt={exports:{}},ms=wt.exports,le;function ks(){return le||(le=1,(function(t,s){(function(r,i){t.exports=i()})(ms,(function(){var r="day";return function(i,a,k){var y=function(A){return A.add(4-A.isoWeekday(),r)},x=a.prototype;x.isoWeekYear=function(){return y(this).year()},x.isoWeek=function(A){if(!this.$utils().u(A))return this.add(7*(A-this.isoWeek()),r);var _,O,P,R,z=y(this),M=(_=this.isoWeekYear(),O=this.$u,P=(O?k.utc:k)().year(_).startOf("year"),R=4-P.isoWeekday(),P.isoWeekday()>4&&(R+=7),P.add(R,r));return z.diff(M,"week")+1},x.isoWeekday=function(A){return this.$utils().u(A)?this.day()||7:this.day(this.day()%7?A:A-7)};var F=x.startOf;x.startOf=function(A,_){var O=this.$utils(),P=!!O.u(_)||_;return O.p(A)==="isoweek"?P?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):F.bind(this)(A,_)}}}))})(wt)),wt.exports}var ys=ks();const gs=$t(ys);var _t={exports:{}},ps=_t.exports,ue;function vs(){return ue||(ue=1,(function(t,s){(function(r,i){t.exports=i()})(ps,(function(){var r={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},i=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,a=/\d/,k=/\d\d/,y=/\d\d?/,x=/\d*[^-_:/,()\s\d]+/,F={},A=function(D){return(D=+D)+(D>68?1900:2e3)},_=function(D){return function(C){this[D]=+C}},O=[/[+-]\d\d:?(\d\d)?|Z/,function(D){(this.zone||(this.zone={})).offset=(function(C){if(!C||C==="Z")return 0;var W=C.match(/([+-]|\d\d)/g),$=60*W[1]+(+W[2]||0);return $===0?0:W[0]==="+"?-$:$})(D)}],P=function(D){var C=F[D];return C&&(C.indexOf?C:C.s.concat(C.f))},R=function(D,C){var W,$=F.meridiem;if($){for(var V=1;V<=24;V+=1)if(D.indexOf($(V,0,C))>-1){W=V>12;break}}else W=D===(C?"pm":"PM");return W},z={A:[x,function(D){this.afternoon=R(D,!1)}],a:[x,function(D){this.afternoon=R(D,!0)}],Q:[a,function(D){this.month=3*(D-1)+1}],S:[a,function(D){this.milliseconds=100*+D}],SS:[k,function(D){this.milliseconds=10*+D}],SSS:[/\d{3}/,function(D){this.milliseconds=+D}],s:[y,_("seconds")],ss:[y,_("seconds")],m:[y,_("minutes")],mm:[y,_("minutes")],H:[y,_("hours")],h:[y,_("hours")],HH:[y,_("hours")],hh:[y,_("hours")],D:[y,_("day")],DD:[k,_("day")],Do:[x,function(D){var C=F.ordinal,W=D.match(/\d+/);if(this.day=W[0],C)for(var $=1;$<=31;$+=1)C($).replace(/\[|\]/g,"")===D&&(this.day=$)}],w:[y,_("week")],ww:[k,_("week")],M:[y,_("month")],MM:[k,_("month")],MMM:[x,function(D){var C=P("months"),W=(P("monthsShort")||C.map((function($){return $.slice(0,3)}))).indexOf(D)+1;if(W<1)throw new Error;this.month=W%12||W}],MMMM:[x,function(D){var C=P("months").indexOf(D)+1;if(C<1)throw new Error;this.month=C%12||C}],Y:[/[+-]?\d+/,_("year")],YY:[k,function(D){this.year=A(D)}],YYYY:[/\d{4}/,_("year")],Z:O,ZZ:O};function M(D){var C,W;C=D,W=F&&F.formats;for(var $=(D=C.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,(function(v,p,g){var f=g&&g.toUpperCase();return p||W[g]||r[g]||W[f].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,(function(o,l,h){return l||h.slice(1)}))}))).match(i),V=$.length,q=0;q<V;q+=1){var E=$[q],T=z[E],d=T&&T[0],u=T&&T[1];$[q]=u?{regex:d,parser:u}:E.replace(/^\[|\]$/g,"")}return function(v){for(var p={},g=0,f=0;g<V;g+=1){var o=$[g];if(typeof o=="string")f+=o.length;else{var l=o.regex,h=o.parser,m=v.slice(f),b=l.exec(m)[0];h.call(p,b),v=v.replace(b,"")}}return(function(n){var N=n.afternoon;if(N!==void 0){var e=n.hours;N?e<12&&(n.hours+=12):e===12&&(n.hours=0),delete n.afternoon}})(p),p}}return function(D,C,W){W.p.customParseFormat=!0,D&&D.parseTwoDigitYear&&(A=D.parseTwoDigitYear);var $=C.prototype,V=$.parse;$.parse=function(q){var E=q.date,T=q.utc,d=q.args;this.$u=T;var u=d[1];if(typeof u=="string"){var v=d[2]===!0,p=d[3]===!0,g=v||p,f=d[2];p&&(f=d[2]),F=this.$locale(),!v&&f&&(F=W.Ls[f]),this.$d=(function(m,b,n,N){try{if(["x","X"].indexOf(b)>-1)return new Date((b==="X"?1e3:1)*m);var e=M(b)(m),w=e.year,L=e.month,Y=e.day,I=e.hours,G=e.minutes,S=e.seconds,Q=e.milliseconds,rt=e.zone,lt=e.week,yt=new Date,gt=Y||(w||L?1:yt.getDate()),ut=w||yt.getFullYear(),H=0;w&&!L||(H=L>0?L-1:yt.getMonth());var Z,X=I||0,at=G||0,K=S||0,nt=Q||0;return rt?new Date(Date.UTC(ut,H,gt,X,at,K,nt+60*rt.offset*1e3)):n?new Date(Date.UTC(ut,H,gt,X,at,K,nt)):(Z=new Date(ut,H,gt,X,at,K,nt),lt&&(Z=N(Z).week(lt).toDate()),Z)}catch{return new Date("")}})(E,u,T,W),this.init(),f&&f!==!0&&(this.$L=this.locale(f).$L),g&&E!=this.format(u)&&(this.$d=new Date("")),F={}}else if(u instanceof Array)for(var o=u.length,l=1;l<=o;l+=1){d[1]=u[l-1];var h=W.apply(this,d);if(h.isValid()){this.$d=h.$d,this.$L=h.$L,this.init();break}l===o&&(this.$d=new Date(""))}else V.call(this,q)}}}))})(_t)),_t.exports}var xs=vs();const Ts=$t(xs);var Dt={exports:{}},bs=Dt.exports,de;function ws(){return de||(de=1,(function(t,s){(function(r,i){t.exports=i()})(bs,(function(){return function(r,i){var a=i.prototype,k=a.format;a.format=function(y){var x=this,F=this.$locale();if(!this.isValid())return k.bind(this)(y);var A=this.$utils(),_=(y||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,(function(O){switch(O){case"Q":return Math.ceil((x.$M+1)/3);case"Do":return F.ordinal(x.$D);case"gggg":return x.weekYear();case"GGGG":return x.isoWeekYear();case"wo":return F.ordinal(x.week(),"W");case"w":case"ww":return A.s(x.week(),O==="w"?1:2,"0");case"W":case"WW":return A.s(x.isoWeek(),O==="W"?1:2,"0");case"k":case"kk":return A.s(String(x.$H===0?24:x.$H),O==="k"?1:2,"0");case"X":return Math.floor(x.$d.getTime()/1e3);case"x":return x.$d.getTime();case"z":return"["+x.offsetName()+"]";case"zzz":return"["+x.offsetName("long")+"]";default:return O}}));return k.bind(this)(_)}}}))})(Dt)),Dt.exports}var _s=ws();const Ds=$t(_s);var Ct={exports:{}},Cs=Ct.exports,fe;function Ss(){return fe||(fe=1,(function(t,s){(function(r,i){t.exports=i()})(Cs,(function(){var r,i,a=1e3,k=6e4,y=36e5,x=864e5,F=31536e6,A=2628e6,_=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,O=/\[([^\]]+)]|YYYY|YY|Y|M{1,2}|D{1,2}|H{1,2}|m{1,2}|s{1,2}|SSS/g,P={years:F,months:A,days:x,hours:y,minutes:k,seconds:a,milliseconds:1,weeks:6048e5},R=function(E){return E instanceof V},z=function(E,T,d){return new V(E,d,T.$l)},M=function(E){return i.p(E)+"s"},D=function(E){return E<0},C=function(E){return D(E)?Math.ceil(E):Math.floor(E)},W=function(E){return Math.abs(E)},$=function(E,T){return E?D(E)?{negative:!0,format:""+W(E)+T}:{negative:!1,format:""+E+T}:{negative:!1,format:""}},V=(function(){function E(d,u,v){var p=this;if(this.$d={},this.$l=v,d===void 0&&(this.$ms=0,this.parseFromMilliseconds()),u)return z(d*P[M(u)],this);if(typeof d=="number")return this.$ms=d,this.parseFromMilliseconds(),this;if(typeof d=="object")return Object.keys(d).forEach((function(o){p.$d[M(o)]=d[o]})),this.calMilliseconds(),this;if(typeof d=="string"){var g=d.match(_);if(g){var f=g.slice(2).map((function(o){return o!=null?Number(o):0}));return this.$d.years=f[0],this.$d.months=f[1],this.$d.weeks=f[2],this.$d.days=f[3],this.$d.hours=f[4],this.$d.minutes=f[5],this.$d.seconds=f[6],this.calMilliseconds(),this}}return this}var T=E.prototype;return T.calMilliseconds=function(){var d=this;this.$ms=Object.keys(this.$d).reduce((function(u,v){return u+(d.$d[v]||0)*P[v]}),0)},T.parseFromMilliseconds=function(){var d=this.$ms;this.$d.years=C(d/F),d%=F,this.$d.months=C(d/A),d%=A,this.$d.days=C(d/x),d%=x,this.$d.hours=C(d/y),d%=y,this.$d.minutes=C(d/k),d%=k,this.$d.seconds=C(d/a),d%=a,this.$d.milliseconds=d},T.toISOString=function(){var d=$(this.$d.years,"Y"),u=$(this.$d.months,"M"),v=+this.$d.days||0;this.$d.weeks&&(v+=7*this.$d.weeks);var p=$(v,"D"),g=$(this.$d.hours,"H"),f=$(this.$d.minutes,"M"),o=this.$d.seconds||0;this.$d.milliseconds&&(o+=this.$d.milliseconds/1e3,o=Math.round(1e3*o)/1e3);var l=$(o,"S"),h=d.negative||u.negative||p.negative||g.negative||f.negative||l.negative,m=g.format||f.format||l.format?"T":"",b=(h?"-":"")+"P"+d.format+u.format+p.format+m+g.format+f.format+l.format;return b==="P"||b==="-P"?"P0D":b},T.toJSON=function(){return this.toISOString()},T.format=function(d){var u=d||"YYYY-MM-DDTHH:mm:ss",v={Y:this.$d.years,YY:i.s(this.$d.years,2,"0"),YYYY:i.s(this.$d.years,4,"0"),M:this.$d.months,MM:i.s(this.$d.months,2,"0"),D:this.$d.days,DD:i.s(this.$d.days,2,"0"),H:this.$d.hours,HH:i.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:i.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:i.s(this.$d.seconds,2,"0"),SSS:i.s(this.$d.milliseconds,3,"0")};return u.replace(O,(function(p,g){return g||String(v[p])}))},T.as=function(d){return this.$ms/P[M(d)]},T.get=function(d){var u=this.$ms,v=M(d);return v==="milliseconds"?u%=1e3:u=v==="weeks"?C(u/P[v]):this.$d[v],u||0},T.add=function(d,u,v){var p;return p=u?d*P[M(u)]:R(d)?d.$ms:z(d,this).$ms,z(this.$ms+p*(v?-1:1),this)},T.subtract=function(d,u){return this.add(d,u,!0)},T.locale=function(d){var u=this.clone();return u.$l=d,u},T.clone=function(){return z(this.$ms,this)},T.humanize=function(d){return r().add(this.$ms,"ms").locale(this.$l).fromNow(!d)},T.valueOf=function(){return this.asMilliseconds()},T.milliseconds=function(){return this.get("milliseconds")},T.asMilliseconds=function(){return this.as("milliseconds")},T.seconds=function(){return this.get("seconds")},T.asSeconds=function(){return this.as("seconds")},T.minutes=function(){return this.get("minutes")},T.asMinutes=function(){return this.as("minutes")},T.hours=function(){return this.get("hours")},T.asHours=function(){return this.as("hours")},T.days=function(){return this.get("days")},T.asDays=function(){return this.as("days")},T.weeks=function(){return this.get("weeks")},T.asWeeks=function(){return this.as("weeks")},T.months=function(){return this.get("months")},T.asMonths=function(){return this.as("months")},T.years=function(){return this.get("years")},T.asYears=function(){return this.as("years")},E})(),q=function(E,T,d){return E.add(T.years()*d,"y").add(T.months()*d,"M").add(T.days()*d,"d").add(T.hours()*d,"h").add(T.minutes()*d,"m").add(T.seconds()*d,"s").add(T.milliseconds()*d,"ms")};return function(E,T,d){r=d,i=d().$utils(),d.duration=function(p,g){var f=d.locale();return z(p,{$l:f},g)},d.isDuration=R;var u=T.prototype.add,v=T.prototype.subtract;T.prototype.add=function(p,g){return R(p)?q(this,p,1):u.bind(this)(p,g)},T.prototype.subtract=function(p,g){return R(p)?q(this,p,-1):v.bind(this)(p,g)}}}))})(Ct)),Ct.exports}var Ms=Ss();const Es=$t(Ms);var zt=(function(){var t=c(function(f,o,l,h){for(l=l||{},h=f.length;h--;l[f[h]]=o);return l},"o"),s=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],r=[1,26],i=[1,27],a=[1,28],k=[1,29],y=[1,30],x=[1,31],F=[1,32],A=[1,33],_=[1,34],O=[1,9],P=[1,10],R=[1,11],z=[1,12],M=[1,13],D=[1,14],C=[1,15],W=[1,16],$=[1,19],V=[1,20],q=[1,21],E=[1,22],T=[1,23],d=[1,25],u=[1,35],v={trace:c(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:c(function(o,l,h,m,b,n,N){var e=n.length-1;switch(b){case 1:return n[e-1];case 2:this.$=[];break;case 3:n[e-1].push(n[e]),this.$=n[e-1];break;case 4:case 5:this.$=n[e];break;case 6:case 7:this.$=[];break;case 8:m.setWeekday("monday");break;case 9:m.setWeekday("tuesday");break;case 10:m.setWeekday("wednesday");break;case 11:m.setWeekday("thursday");break;case 12:m.setWeekday("friday");break;case 13:m.setWeekday("saturday");break;case 14:m.setWeekday("sunday");break;case 15:m.setWeekend("friday");break;case 16:m.setWeekend("saturday");break;case 17:m.setDateFormat(n[e].substr(11)),this.$=n[e].substr(11);break;case 18:m.enableInclusiveEndDates(),this.$=n[e].substr(18);break;case 19:m.TopAxis(),this.$=n[e].substr(8);break;case 20:m.setAxisFormat(n[e].substr(11)),this.$=n[e].substr(11);break;case 21:m.setTickInterval(n[e].substr(13)),this.$=n[e].substr(13);break;case 22:m.setExcludes(n[e].substr(9)),this.$=n[e].substr(9);break;case 23:m.setIncludes(n[e].substr(9)),this.$=n[e].substr(9);break;case 24:m.setTodayMarker(n[e].substr(12)),this.$=n[e].substr(12);break;case 27:m.setDiagramTitle(n[e].substr(6)),this.$=n[e].substr(6);break;case 28:this.$=n[e].trim(),m.setAccTitle(this.$);break;case 29:case 30:this.$=n[e].trim(),m.setAccDescription(this.$);break;case 31:m.addSection(n[e].substr(8)),this.$=n[e].substr(8);break;case 33:m.addTask(n[e-1],n[e]),this.$="task";break;case 34:this.$=n[e-1],m.setClickEvent(n[e-1],n[e],null);break;case 35:this.$=n[e-2],m.setClickEvent(n[e-2],n[e-1],n[e]);break;case 36:this.$=n[e-2],m.setClickEvent(n[e-2],n[e-1],null),m.setLink(n[e-2],n[e]);break;case 37:this.$=n[e-3],m.setClickEvent(n[e-3],n[e-2],n[e-1]),m.setLink(n[e-3],n[e]);break;case 38:this.$=n[e-2],m.setClickEvent(n[e-2],n[e],null),m.setLink(n[e-2],n[e-1]);break;case 39:this.$=n[e-3],m.setClickEvent(n[e-3],n[e-1],n[e]),m.setLink(n[e-3],n[e-2]);break;case 40:this.$=n[e-1],m.setLink(n[e-1],n[e]);break;case 41:case 47:this.$=n[e-1]+" "+n[e];break;case 42:case 43:case 45:this.$=n[e-2]+" "+n[e-1]+" "+n[e];break;case 44:case 46:this.$=n[e-3]+" "+n[e-2]+" "+n[e-1]+" "+n[e];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(s,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:r,13:i,14:a,15:k,16:y,17:x,18:F,19:18,20:A,21:_,22:O,23:P,24:R,25:z,26:M,27:D,28:C,29:W,30:$,31:V,33:q,35:E,36:T,37:24,38:d,40:u},t(s,[2,7],{1:[2,1]}),t(s,[2,3]),{9:36,11:17,12:r,13:i,14:a,15:k,16:y,17:x,18:F,19:18,20:A,21:_,22:O,23:P,24:R,25:z,26:M,27:D,28:C,29:W,30:$,31:V,33:q,35:E,36:T,37:24,38:d,40:u},t(s,[2,5]),t(s,[2,6]),t(s,[2,17]),t(s,[2,18]),t(s,[2,19]),t(s,[2,20]),t(s,[2,21]),t(s,[2,22]),t(s,[2,23]),t(s,[2,24]),t(s,[2,25]),t(s,[2,26]),t(s,[2,27]),{32:[1,37]},{34:[1,38]},t(s,[2,30]),t(s,[2,31]),t(s,[2,32]),{39:[1,39]},t(s,[2,8]),t(s,[2,9]),t(s,[2,10]),t(s,[2,11]),t(s,[2,12]),t(s,[2,13]),t(s,[2,14]),t(s,[2,15]),t(s,[2,16]),{41:[1,40],43:[1,41]},t(s,[2,4]),t(s,[2,28]),t(s,[2,29]),t(s,[2,33]),t(s,[2,34],{42:[1,42],43:[1,43]}),t(s,[2,40],{41:[1,44]}),t(s,[2,35],{43:[1,45]}),t(s,[2,36]),t(s,[2,38],{42:[1,46]}),t(s,[2,37]),t(s,[2,39])],defaultActions:{},parseError:c(function(o,l){if(l.recoverable)this.trace(o);else{var h=new Error(o);throw h.hash=l,h}},"parseError"),parse:c(function(o){var l=this,h=[0],m=[],b=[null],n=[],N=this.table,e="",w=0,L=0,Y=2,I=1,G=n.slice.call(arguments,1),S=Object.create(this.lexer),Q={yy:{}};for(var rt in this.yy)Object.prototype.hasOwnProperty.call(this.yy,rt)&&(Q.yy[rt]=this.yy[rt]);S.setInput(o,Q.yy),Q.yy.lexer=S,Q.yy.parser=this,typeof S.yylloc>"u"&&(S.yylloc={});var lt=S.yylloc;n.push(lt);var yt=S.options&&S.options.ranges;typeof Q.yy.parseError=="function"?this.parseError=Q.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function gt(U){h.length=h.length-2*U,b.length=b.length-U,n.length=n.length-U}c(gt,"popStack");function ut(){var U;return U=m.pop()||S.lex()||I,typeof U!="number"&&(U instanceof Array&&(m=U,U=m.pop()),U=l.symbols_[U]||U),U}c(ut,"lex");for(var H,Z,X,at,K={},nt,J,ee,Tt;;){if(Z=h[h.length-1],this.defaultActions[Z]?X=this.defaultActions[Z]:((H===null||typeof H>"u")&&(H=ut()),X=N[Z]&&N[Z][H]),typeof X>"u"||!X.length||!X[0]){var Lt="";Tt=[];for(nt in N[Z])this.terminals_[nt]&&nt>Y&&Tt.push("'"+this.terminals_[nt]+"'");S.showPosition?Lt="Parse error on line "+(w+1)+`:
`+S.showPosition()+`
Expecting `+Tt.join(", ")+", got '"+(this.terminals_[H]||H)+"'":Lt="Parse error on line "+(w+1)+": Unexpected "+(H==I?"end of input":"'"+(this.terminals_[H]||H)+"'"),this.parseError(Lt,{text:S.match,token:this.terminals_[H]||H,line:S.yylineno,loc:lt,expected:Tt})}if(X[0]instanceof Array&&X.length>1)throw new Error("Parse Error: multiple actions possible at state: "+Z+", token: "+H);switch(X[0]){case 1:h.push(H),b.push(S.yytext),n.push(S.yylloc),h.push(X[1]),H=null,L=S.yyleng,e=S.yytext,w=S.yylineno,lt=S.yylloc;break;case 2:if(J=this.productions_[X[1]][1],K.$=b[b.length-J],K._$={first_line:n[n.length-(J||1)].first_line,last_line:n[n.length-1].last_line,first_column:n[n.length-(J||1)].first_column,last_column:n[n.length-1].last_column},yt&&(K._$.range=[n[n.length-(J||1)].range[0],n[n.length-1].range[1]]),at=this.performAction.apply(K,[e,L,w,Q.yy,X[1],b,n].concat(G)),typeof at<"u")return at;J&&(h=h.slice(0,-1*J*2),b=b.slice(0,-1*J),n=n.slice(0,-1*J)),h.push(this.productions_[X[1]][0]),b.push(K.$),n.push(K._$),ee=N[h[h.length-2]][h[h.length-1]],h.push(ee);break;case 3:return!0}}return!0},"parse")},p=(function(){var f={EOF:1,parseError:c(function(l,h){if(this.yy.parser)this.yy.parser.parseError(l,h);else throw new Error(l)},"parseError"),setInput:c(function(o,l){return this.yy=l||this.yy||{},this._input=o,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:c(function(){var o=this._input[0];this.yytext+=o,this.yyleng++,this.offset++,this.match+=o,this.matched+=o;var l=o.match(/(?:\r\n?|\n).*/g);return l?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),o},"input"),unput:c(function(o){var l=o.length,h=o.split(/(?:\r\n?|\n)/g);this._input=o+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-l),this.offset-=l;var m=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),h.length-1&&(this.yylineno-=h.length-1);var b=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:h?(h.length===m.length?this.yylloc.first_column:0)+m[m.length-h.length].length-h[0].length:this.yylloc.first_column-l},this.options.ranges&&(this.yylloc.range=[b[0],b[0]+this.yyleng-l]),this.yyleng=this.yytext.length,this},"unput"),more:c(function(){return this._more=!0,this},"more"),reject:c(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:c(function(o){this.unput(this.match.slice(o))},"less"),pastInput:c(function(){var o=this.matched.substr(0,this.matched.length-this.match.length);return(o.length>20?"...":"")+o.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:c(function(){var o=this.match;return o.length<20&&(o+=this._input.substr(0,20-o.length)),(o.substr(0,20)+(o.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:c(function(){var o=this.pastInput(),l=new Array(o.length+1).join("-");return o+this.upcomingInput()+`
`+l+"^"},"showPosition"),test_match:c(function(o,l){var h,m,b;if(this.options.backtrack_lexer&&(b={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(b.yylloc.range=this.yylloc.range.slice(0))),m=o[0].match(/(?:\r\n?|\n).*/g),m&&(this.yylineno+=m.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:m?m[m.length-1].length-m[m.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+o[0].length},this.yytext+=o[0],this.match+=o[0],this.matches=o,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(o[0].length),this.matched+=o[0],h=this.performAction.call(this,this.yy,this,l,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),h)return h;if(this._backtrack){for(var n in b)this[n]=b[n];return!1}return!1},"test_match"),next:c(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var o,l,h,m;this._more||(this.yytext="",this.match="");for(var b=this._currentRules(),n=0;n<b.length;n++)if(h=this._input.match(this.rules[b[n]]),h&&(!l||h[0].length>l[0].length)){if(l=h,m=n,this.options.backtrack_lexer){if(o=this.test_match(h,b[n]),o!==!1)return o;if(this._backtrack){l=!1;continue}else return!1}else if(!this.options.flex)break}return l?(o=this.test_match(l,b[m]),o!==!1?o:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:c(function(){var l=this.next();return l||this.lex()},"lex"),begin:c(function(l){this.conditionStack.push(l)},"begin"),popState:c(function(){var l=this.conditionStack.length-1;return l>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:c(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:c(function(l){return l=this.conditionStack.length-1-Math.abs(l||0),l>=0?this.conditionStack[l]:"INITIAL"},"topState"),pushState:c(function(l){this.begin(l)},"pushState"),stateStackSize:c(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:c(function(l,h,m,b){switch(m){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}};return f})();v.lexer=p;function g(){this.yy={}}return c(g,"Parser"),g.prototype=v,v.Parser=g,new g})();zt.parser=zt;var Is=zt;j.extend(gs);j.extend(Ts);j.extend(Ds);var he={friday:5,saturday:6},tt="",qt="",Gt=void 0,jt="",pt=[],vt=[],Xt=new Map,Ut=[],It=[],kt="",Zt="",Se=["active","done","crit","milestone","vert"],Qt=[],dt="",xt=!1,Kt=!1,Jt="sunday",Yt="saturday",Vt=0,Ys=c(function(){Ut=[],It=[],kt="",Qt=[],St=0,Bt=void 0,Mt=void 0,B=[],tt="",qt="",Zt="",Gt=void 0,jt="",pt=[],vt=[],xt=!1,Kt=!1,Vt=0,Xt=new Map,dt="",Be(),Jt="sunday",Yt="saturday"},"clear"),$s=c(function(t){dt=t},"setDiagramId"),Ls=c(function(t){qt=t},"setAxisFormat"),Fs=c(function(){return qt},"getAxisFormat"),As=c(function(t){Gt=t},"setTickInterval"),Os=c(function(){return Gt},"getTickInterval"),Ws=c(function(t){jt=t},"setTodayMarker"),Ns=c(function(){return jt},"getTodayMarker"),Ps=c(function(t){tt=t},"setDateFormat"),Rs=c(function(){xt=!0},"enableInclusiveEndDates"),zs=c(function(){return xt},"endDatesAreInclusive"),Vs=c(function(){Kt=!0},"enableTopAxis"),Hs=c(function(){return Kt},"topAxisEnabled"),Bs=c(function(t){Zt=t},"setDisplayMode"),qs=c(function(){return Zt},"getDisplayMode"),Gs=c(function(){return tt},"getDateFormat"),js=c(function(t){pt=t.toLowerCase().split(/[\s,]+/)},"setIncludes"),Xs=c(function(){return pt},"getIncludes"),Us=c(function(t){vt=t.toLowerCase().split(/[\s,]+/)},"setExcludes"),Zs=c(function(){return vt},"getExcludes"),Qs=c(function(){return Xt},"getLinks"),Ks=c(function(t){kt=t,Ut.push(t)},"addSection"),Js=c(function(){return Ut},"getSections"),ti=c(function(){let t=me();const s=10;let r=0;for(;!t&&r<s;)t=me(),r++;return It=B,It},"getTasks"),Me=c(function(t,s,r,i){const a=t.format(s.trim()),k=t.format("YYYY-MM-DD");return i.includes(a)||i.includes(k)?!1:r.includes("weekends")&&(t.isoWeekday()===he[Yt]||t.isoWeekday()===he[Yt]+1)||r.includes(t.format("dddd").toLowerCase())?!0:r.includes(a)||r.includes(k)},"isInvalidDate"),ei=c(function(t){Jt=t},"setWeekday"),si=c(function(){return Jt},"getWeekday"),ii=c(function(t){Yt=t},"setWeekend"),Ee=c(function(t,s,r,i){if(!r.length||t.manualEndTime)return;let a;t.startTime instanceof Date?a=j(t.startTime):a=j(t.startTime,s,!0),a=a.add(1,"d");let k;t.endTime instanceof Date?k=j(t.endTime):k=j(t.endTime,s,!0);const[y,x]=ri(a,k,s,r,i);t.endTime=y.toDate(),t.renderEndTime=x},"checkTaskDates"),ri=c(function(t,s,r,i,a){let k=!1,y=null;const x=s.add(1e4,"d");for(;t<=s;){if(k||(y=s.toDate()),k=Me(t,r,i,a),k&&(s=s.add(1,"d"),s>x))throw new Error("Failed to find a valid date that was not excluded by `excludes` after 10,000 iterations.");t=t.add(1,"d")}return[s,y]},"fixTaskDates"),Ht=c(function(t,s,r){if(r=r.trim(),c(x=>{const F=x.trim();return F==="x"||F==="X"},"isTimestampFormat")(s)&&/^\d+$/.test(r))return new Date(Number(r));const k=/^after\s+(?<ids>[\d\w- ]+)/.exec(r);if(k!==null){let x=null;for(const A of k.groups.ids.split(" ")){let _=ct(A);_!==void 0&&(!x||_.endTime>x.endTime)&&(x=_)}if(x)return x.endTime;const F=new Date;return F.setHours(0,0,0,0),F}let y=j(r,s.trim(),!0);if(y.isValid())return y.toDate();{ot.debug("Invalid date:"+r),ot.debug("With date format:"+s.trim());const x=new Date(r);if(x===void 0||isNaN(x.getTime())||x.getFullYear()<-1e4||x.getFullYear()>1e4)throw new Error("Invalid date:"+r);return x}},"getStartDate"),Ie=c(function(t){const s=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return s!==null?[Number.parseFloat(s[1]),s[2]]:[NaN,"ms"]},"parseDuration"),Ye=c(function(t,s,r,i=!1){r=r.trim();const k=/^until\s+(?<ids>[\d\w- ]+)/.exec(r);if(k!==null){let _=null;for(const P of k.groups.ids.split(" ")){let R=ct(P);R!==void 0&&(!_||R.startTime<_.startTime)&&(_=R)}if(_)return _.startTime;const O=new Date;return O.setHours(0,0,0,0),O}let y=j(r,s.trim(),!0);if(y.isValid())return i&&(y=y.add(1,"d")),y.toDate();let x=j(t);const[F,A]=Ie(r);if(!Number.isNaN(F)){const _=x.add(F,A);_.isValid()&&(x=_)}return x.toDate()},"getEndDate"),St=0,mt=c(function(t){return t===void 0?(St=St+1,"task"+St):t},"parseId"),ni=c(function(t,s){let r;s.substr(0,1)===":"?r=s.substr(1,s.length):r=s;const i=r.split(","),a={};te(i,a,Se);for(let y=0;y<i.length;y++)i[y]=i[y].trim();let k="";switch(i.length){case 1:a.id=mt(),a.startTime=t.endTime,k=i[0];break;case 2:a.id=mt(),a.startTime=Ht(void 0,tt,i[0]),k=i[1];break;case 3:a.id=mt(i[0]),a.startTime=Ht(void 0,tt,i[1]),k=i[2];break}return k&&(a.endTime=Ye(a.startTime,tt,k,xt),a.manualEndTime=j(k,"YYYY-MM-DD",!0).isValid(),Ee(a,tt,vt,pt)),a},"compileData"),ai=c(function(t,s){let r;s.substr(0,1)===":"?r=s.substr(1,s.length):r=s;const i=r.split(","),a={};te(i,a,Se);for(let k=0;k<i.length;k++)i[k]=i[k].trim();switch(i.length){case 1:a.id=mt(),a.startTime={type:"prevTaskEnd",id:t},a.endTime={data:i[0]};break;case 2:a.id=mt(),a.startTime={type:"getStartDate",startData:i[0]},a.endTime={data:i[1]};break;case 3:a.id=mt(i[0]),a.startTime={type:"getStartDate",startData:i[1]},a.endTime={data:i[2]};break}return a},"parseData"),Bt,Mt,B=[],$e={},oi=c(function(t,s){const r={section:kt,type:kt,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:s},task:t,classes:[]},i=ai(Mt,s);r.raw.startTime=i.startTime,r.raw.endTime=i.endTime,r.id=i.id,r.prevTaskId=Mt,r.active=i.active,r.done=i.done,r.crit=i.crit,r.milestone=i.milestone,r.vert=i.vert,r.order=Vt,Vt++;const a=B.push(r);Mt=r.id,$e[r.id]=a-1},"addTask"),ct=c(function(t){const s=$e[t];return B[s]},"findTaskById"),ci=c(function(t,s){const r={section:kt,type:kt,description:t,task:t,classes:[]},i=ni(Bt,s);r.startTime=i.startTime,r.endTime=i.endTime,r.id=i.id,r.active=i.active,r.done=i.done,r.crit=i.crit,r.milestone=i.milestone,r.vert=i.vert,Bt=r,It.push(r)},"addTaskOrg"),me=c(function(){const t=c(function(r){const i=B[r];let a="";switch(B[r].raw.startTime.type){case"prevTaskEnd":{const k=ct(i.prevTaskId);i.startTime=k.endTime;break}case"getStartDate":a=Ht(void 0,tt,B[r].raw.startTime.startData),a&&(B[r].startTime=a);break}return B[r].startTime&&(B[r].endTime=Ye(B[r].startTime,tt,B[r].raw.endTime.data,xt),B[r].endTime&&(B[r].processed=!0,B[r].manualEndTime=j(B[r].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),Ee(B[r],tt,vt,pt))),B[r].processed},"compileTask");let s=!0;for(const[r,i]of B.entries())t(r),s=s&&i.processed;return s},"compileTasks"),li=c(function(t,s){let r=s;ft().securityLevel!=="loose"&&(r=He.sanitizeUrl(s)),t.split(",").forEach(function(i){ct(i)!==void 0&&(Fe(i,()=>{window.open(r,"_self")}),Xt.set(i,r))}),Le(t,"clickable")},"setLink"),Le=c(function(t,s){t.split(",").forEach(function(r){let i=ct(r);i!==void 0&&i.classes.push(s)})},"setClass"),ui=c(function(t,s,r){if(ft().securityLevel!=="loose"||s===void 0)return;let i=[];if(typeof r=="string"){i=r.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let k=0;k<i.length;k++){let y=i[k].trim();y.startsWith('"')&&y.endsWith('"')&&(y=y.substr(1,y.length-2)),i[k]=y}}i.length===0&&i.push(t),ct(t)!==void 0&&Fe(t,()=>{qe.runFunc(s,...i)})},"setClickFun"),Fe=c(function(t,s){Qt.push(function(){const r=dt?`${dt}-${t}`:t,i=document.querySelector(`[id="${r}"]`);i!==null&&i.addEventListener("click",function(){s()})},function(){const r=dt?`${dt}-${t}`:t,i=document.querySelector(`[id="${r}-text"]`);i!==null&&i.addEventListener("click",function(){s()})})},"pushFun"),di=c(function(t,s,r){t.split(",").forEach(function(i){ui(i,s,r)}),Le(t,"clickable")},"setClickEvent"),fi=c(function(t){Qt.forEach(function(s){s(t)})},"bindFunctions"),hi={getConfig:c(()=>ft().gantt,"getConfig"),clear:Ys,setDateFormat:Ps,getDateFormat:Gs,enableInclusiveEndDates:Rs,endDatesAreInclusive:zs,enableTopAxis:Vs,topAxisEnabled:Hs,setAxisFormat:Ls,getAxisFormat:Fs,setTickInterval:As,getTickInterval:Os,setTodayMarker:Ws,getTodayMarker:Ns,setAccTitle:Re,getAccTitle:Pe,setDiagramTitle:Ne,getDiagramTitle:We,setDiagramId:$s,setDisplayMode:Bs,getDisplayMode:qs,setAccDescription:Oe,getAccDescription:Ae,addSection:Ks,getSections:Js,getTasks:ti,addTask:oi,findTaskById:ct,addTaskOrg:ci,setIncludes:js,getIncludes:Xs,setExcludes:Us,getExcludes:Zs,setClickEvent:di,setLink:li,getLinks:Qs,bindFunctions:fi,parseDuration:Ie,isInvalidDate:Me,setWeekday:ei,getWeekday:si,setWeekend:ii};function te(t,s,r){let i=!0;for(;i;)i=!1,r.forEach(function(a){const k="^\\s*"+a+"\\s*$",y=new RegExp(k);t[0].match(y)&&(s[a]=!0,t.shift(1),i=!0)})}c(te,"getTaskTags");j.extend(Es);var mi=c(function(){ot.debug("Something is calling, setConf, remove the call")},"setConf"),ke={monday:ss,tuesday:es,wednesday:ts,thursday:Je,friday:Ke,saturday:Qe,sunday:Ze},ki=c((t,s)=>{let r=[...t].map(()=>-1/0),i=[...t].sort((k,y)=>k.startTime-y.startTime||k.order-y.order),a=0;for(const k of i)for(let y=0;y<r.length;y++)if(k.startTime>=r[y]){r[y]=k.endTime,k.order=y+s,y>a&&(a=y);break}return a},"getMaxIntersections"),st,Pt=1e4,yi=c(function(t,s,r,i){const a=ft().gantt;i.db.setDiagramId(s);const k=ft().securityLevel;let y;k==="sandbox"&&(y=bt("#i"+s));const x=k==="sandbox"?bt(y.nodes()[0].contentDocument.body):bt("body"),F=k==="sandbox"?y.nodes()[0].contentDocument:document,A=F.getElementById(s);st=A.parentElement.offsetWidth,st===void 0&&(st=1200),a.useWidth!==void 0&&(st=a.useWidth);const _=i.db.getTasks();let O=[];for(const u of _)O.push(u.type);O=d(O);const P={};let R=2*a.topPadding;if(i.db.getDisplayMode()==="compact"||a.displayMode==="compact"){const u={};for(const p of _)u[p.section]===void 0?u[p.section]=[p]:u[p.section].push(p);let v=0;for(const p of Object.keys(u)){const g=ki(u[p],v)+1;v+=g,R+=g*(a.barHeight+a.barGap),P[p]=g}}else{R+=_.length*(a.barHeight+a.barGap);for(const u of O)P[u]=_.filter(v=>v.type===u).length}A.setAttribute("viewBox","0 0 "+st+" "+R);const z=x.select(`[id="${s}"]`),M=Xe().domain([rs(_,function(u){return u.startTime}),ns(_,function(u){return u.endTime})]).rangeRound([0,st-a.leftPadding-a.rightPadding]);function D(u,v){const p=u.startTime,g=v.startTime;let f=0;return p>g?f=1:p<g&&(f=-1),f}c(D,"taskCompare"),_.sort(D),C(_,st,R),ze(z,R,st,a.useMaxWidth),z.append("text").text(i.db.getDiagramTitle()).attr("x",st/2).attr("y",a.titleTopMargin).attr("class","titleText");function C(u,v,p){const g=a.barHeight,f=g+a.barGap,o=a.topPadding,l=a.leftPadding,h=as().domain([0,O.length]).range(["#00B9FA","#F95002"]).interpolate(hs);$(f,o,l,v,p,u,i.db.getExcludes(),i.db.getIncludes()),q(l,o,v,p),W(u,f,o,l,g,h,v),E(f,o),T(l,o,v,p)}c(C,"makeGantt");function W(u,v,p,g,f,o,l){u.sort((e,w)=>e.vert===w.vert?0:e.vert?1:-1);const m=[...new Set(u.map(e=>e.order))].map(e=>u.find(w=>w.order===e));z.append("g").selectAll("rect").data(m).enter().append("rect").attr("x",0).attr("y",function(e,w){return w=e.order,w*v+p-2}).attr("width",function(){return l-a.rightPadding/2}).attr("height",v).attr("class",function(e){for(const[w,L]of O.entries())if(e.type===L)return"section section"+w%a.numberSectionStyles;return"section section0"}).enter();const b=z.append("g").selectAll("rect").data(u).enter(),n=i.db.getLinks();if(b.append("rect").attr("id",function(e){return s+"-"+e.id}).attr("rx",3).attr("ry",3).attr("x",function(e){return e.milestone?M(e.startTime)+g+.5*(M(e.endTime)-M(e.startTime))-.5*f:M(e.startTime)+g}).attr("y",function(e,w){return w=e.order,e.vert?a.gridLineStartPadding:w*v+p}).attr("width",function(e){return e.milestone?f:e.vert?.08*f:M(e.renderEndTime||e.endTime)-M(e.startTime)}).attr("height",function(e){return e.vert?_.length*(a.barHeight+a.barGap)+a.barHeight*2:f}).attr("transform-origin",function(e,w){return w=e.order,(M(e.startTime)+g+.5*(M(e.endTime)-M(e.startTime))).toString()+"px "+(w*v+p+.5*f).toString()+"px"}).attr("class",function(e){const w="task";let L="";e.classes.length>0&&(L=e.classes.join(" "));let Y=0;for(const[G,S]of O.entries())e.type===S&&(Y=G%a.numberSectionStyles);let I="";return e.active?e.crit?I+=" activeCrit":I=" active":e.done?e.crit?I=" doneCrit":I=" done":e.crit&&(I+=" crit"),I.length===0&&(I=" task"),e.milestone&&(I=" milestone "+I),e.vert&&(I=" vert "+I),I+=Y,I+=" "+L,w+I}),b.append("text").attr("id",function(e){return s+"-"+e.id+"-text"}).text(function(e){return e.task}).attr("font-size",a.fontSize).attr("x",function(e){let w=M(e.startTime),L=M(e.renderEndTime||e.endTime);if(e.milestone&&(w+=.5*(M(e.endTime)-M(e.startTime))-.5*f,L=w+f),e.vert)return M(e.startTime)+g;const Y=this.getBBox().width;return Y>L-w?L+Y+1.5*a.leftPadding>l?w+g-5:L+g+5:(L-w)/2+w+g}).attr("y",function(e,w){return e.vert?a.gridLineStartPadding+_.length*(a.barHeight+a.barGap)+60:(w=e.order,w*v+a.barHeight/2+(a.fontSize/2-2)+p)}).attr("text-height",f).attr("class",function(e){const w=M(e.startTime);let L=M(e.endTime);e.milestone&&(L=w+f);const Y=this.getBBox().width;let I="";e.classes.length>0&&(I=e.classes.join(" "));let G=0;for(const[Q,rt]of O.entries())e.type===rt&&(G=Q%a.numberSectionStyles);let S="";return e.active&&(e.crit?S="activeCritText"+G:S="activeText"+G),e.done?e.crit?S=S+" doneCritText"+G:S=S+" doneText"+G:e.crit&&(S=S+" critText"+G),e.milestone&&(S+=" milestoneText"),e.vert&&(S+=" vertText"),Y>L-w?L+Y+1.5*a.leftPadding>l?I+" taskTextOutsideLeft taskTextOutside"+G+" "+S:I+" taskTextOutsideRight taskTextOutside"+G+" "+S+" width-"+Y:I+" taskText taskText"+G+" "+S+" width-"+Y}),ft().securityLevel==="sandbox"){let e;e=bt("#i"+s);const w=e.nodes()[0].contentDocument;b.filter(function(L){return n.has(L.id)}).each(function(L){var Y=w.querySelector("#"+CSS.escape(s+"-"+L.id)),I=w.querySelector("#"+CSS.escape(s+"-"+L.id+"-text"));const G=Y.parentNode;var S=w.createElement("a");S.setAttribute("xlink:href",n.get(L.id)),S.setAttribute("target","_top"),G.appendChild(S),S.appendChild(Y),S.appendChild(I)})}}c(W,"drawRects");function $(u,v,p,g,f,o,l,h){if(l.length===0&&h.length===0)return;let m,b;for(const{startTime:Y,endTime:I}of o)(m===void 0||Y<m)&&(m=Y),(b===void 0||I>b)&&(b=I);if(!m||!b)return;if(j(b).diff(j(m),"year")>5){ot.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const n=i.db.getDateFormat(),N=[];let e=null,w=j(m);for(;w.valueOf()<=b;)i.db.isInvalidDate(w,n,l,h)?e?e.end=w:e={start:w,end:w}:e&&(N.push(e),e=null),w=w.add(1,"d");z.append("g").selectAll("rect").data(N).enter().append("rect").attr("id",Y=>s+"-exclude-"+Y.start.format("YYYY-MM-DD")).attr("x",Y=>M(Y.start.startOf("day"))+p).attr("y",a.gridLineStartPadding).attr("width",Y=>M(Y.end.endOf("day"))-M(Y.start.startOf("day"))).attr("height",f-v-a.gridLineStartPadding).attr("transform-origin",function(Y,I){return(M(Y.start)+p+.5*(M(Y.end)-M(Y.start))).toString()+"px "+(I*u+.5*f).toString()+"px"}).attr("class","exclude-range")}c($,"drawExcludeDays");function V(u,v,p,g){if(p<=0||u>v)return 1/0;const f=v-u,o=j.duration({[g??"day"]:p}).asMilliseconds();return o<=0?1/0:Math.ceil(f/o)}c(V,"getEstimatedTickCount");function q(u,v,p,g){const f=i.db.getDateFormat(),o=i.db.getAxisFormat();let l;o?l=o:f==="D"?l="%d":l=a.axisFormat??"%Y-%m-%d";let h=Ue(M).tickSize(-g+v+a.gridLineStartPadding).tickFormat(se(l));const b=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(i.db.getTickInterval()||a.tickInterval);if(b!==null){const n=parseInt(b[1],10);if(isNaN(n)||n<=0)ot.warn(`Invalid tick interval value: "${b[1]}". Skipping custom tick interval.`);else{const N=b[2],e=i.db.getWeekday()||a.weekday,w=M.domain(),L=w[0],Y=w[1],I=V(L,Y,n,N);if(I>Pt)ot.warn(`The tick interval "${n}${N}" would generate ${I} ticks, which exceeds the maximum allowed (${Pt}). This may indicate an invalid date or time range. Skipping custom tick interval.`);else switch(N){case"millisecond":h.ticks(ce.every(n));break;case"second":h.ticks(oe.every(n));break;case"minute":h.ticks(ae.every(n));break;case"hour":h.ticks(ne.every(n));break;case"day":h.ticks(re.every(n));break;case"week":h.ticks(ke[e].every(n));break;case"month":h.ticks(ie.every(n));break}}}if(z.append("g").attr("class","grid").attr("transform","translate("+u+", "+(g-50)+")").call(h).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),i.db.topAxisEnabled()||a.topAxis){let n=is(M).tickSize(-g+v+a.gridLineStartPadding).tickFormat(se(l));if(b!==null){const N=parseInt(b[1],10);if(isNaN(N)||N<=0)ot.warn(`Invalid tick interval value: "${b[1]}". Skipping custom tick interval.`);else{const e=b[2],w=i.db.getWeekday()||a.weekday,L=M.domain(),Y=L[0],I=L[1];if(V(Y,I,N,e)<=Pt)switch(e){case"millisecond":n.ticks(ce.every(N));break;case"second":n.ticks(oe.every(N));break;case"minute":n.ticks(ae.every(N));break;case"hour":n.ticks(ne.every(N));break;case"day":n.ticks(re.every(N));break;case"week":n.ticks(ke[w].every(N));break;case"month":n.ticks(ie.every(N));break}}}z.append("g").attr("class","grid").attr("transform","translate("+u+", "+v+")").call(n).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}c(q,"makeGrid");function E(u,v){let p=0;const g=Object.keys(P).map(f=>[f,P[f]]);z.append("g").selectAll("text").data(g).enter().append(function(f){const o=f[0].split(Ve.lineBreakRegex),l=-(o.length-1)/2,h=F.createElementNS("http://www.w3.org/2000/svg","text");h.setAttribute("dy",l+"em");for(const[m,b]of o.entries()){const n=F.createElementNS("http://www.w3.org/2000/svg","tspan");n.setAttribute("alignment-baseline","central"),n.setAttribute("x","10"),m>0&&n.setAttribute("dy","1em"),n.textContent=b,h.appendChild(n)}return h}).attr("x",10).attr("y",function(f,o){if(o>0)for(let l=0;l<o;l++)return p+=g[o-1][1],f[1]*u/2+p*u+v;else return f[1]*u/2+v}).attr("font-size",a.sectionFontSize).attr("class",function(f){for(const[o,l]of O.entries())if(f[0]===l)return"sectionTitle sectionTitle"+o%a.numberSectionStyles;return"sectionTitle"})}c(E,"vertLabels");function T(u,v,p,g){const f=i.db.getTodayMarker();if(f==="off")return;const o=z.append("g").attr("class","today"),l=new Date,h=o.append("line");h.attr("x1",M(l)+u).attr("x2",M(l)+u).attr("y1",a.titleTopMargin).attr("y2",g-a.titleTopMargin).attr("class","today"),f!==""&&h.attr("style",f.replace(/,/g,";"))}c(T,"drawToday");function d(u){const v={},p=[];for(let g=0,f=u.length;g<f;++g)Object.prototype.hasOwnProperty.call(v,u[g])||(v[u[g]]=!0,p.push(u[g]));return p}c(d,"checkUnique")},"draw"),gi={setConf:mi,draw:yi},pi=c(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done task text displayed outside the bar sits against the diagram background,
     not against the done-task bar, so it must use the outside/contrast color. */
  .doneText0.taskTextOutsideLeft,
  .doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,
  .doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,
  .doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,
  .doneText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done-crit task text outside the bar — same reasoning as doneText above. */
  .doneCritText0.taskTextOutsideLeft,
  .doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,
  .doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,
  .doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,
  .doneCritText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles"),vi=pi,Ei={parser:Is,db:hi,renderer:gi,styles:vi};export{Ei as diagram};
