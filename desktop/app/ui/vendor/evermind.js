function yu(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var Es = { exports: {} }, qi = {}, _s = { exports: {} }, ze = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Rf;
function Sy() {
  if (Rf) return ze;
  Rf = 1;
  var e = Symbol.for("react.element"), r = Symbol.for("react.portal"), i = Symbol.for("react.fragment"), o = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), s = Symbol.for("react.provider"), c = Symbol.for("react.context"), d = Symbol.for("react.forward_ref"), p = Symbol.for("react.suspense"), h = Symbol.for("react.memo"), m = Symbol.for("react.lazy"), v = Symbol.iterator;
  function w(_) {
    return _ === null || typeof _ != "object" ? null : (_ = v && _[v] || _["@@iterator"], typeof _ == "function" ? _ : null);
  }
  var x = { isMounted: function() {
    return !1;
  }, enqueueForceUpdate: function() {
  }, enqueueReplaceState: function() {
  }, enqueueSetState: function() {
  } }, E = Object.assign, L = {};
  function D(_, O, S) {
    this.props = _, this.context = O, this.refs = L, this.updater = S || x;
  }
  D.prototype.isReactComponent = {}, D.prototype.setState = function(_, O) {
    if (typeof _ != "object" && typeof _ != "function" && _ != null) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
    this.updater.enqueueSetState(this, _, O, "setState");
  }, D.prototype.forceUpdate = function(_) {
    this.updater.enqueueForceUpdate(this, _, "forceUpdate");
  };
  function z() {
  }
  z.prototype = D.prototype;
  function U(_, O, S) {
    this.props = _, this.context = O, this.refs = L, this.updater = S || x;
  }
  var B = U.prototype = new z();
  B.constructor = U, E(B, D.prototype), B.isPureReactComponent = !0;
  var ne = Array.isArray, Z = Object.prototype.hasOwnProperty, j = { current: null }, Y = { key: !0, ref: !0, __self: !0, __source: !0 };
  function se(_, O, S) {
    var le, ye = {}, he = null, Re = null;
    if (O != null) for (le in O.ref !== void 0 && (Re = O.ref), O.key !== void 0 && (he = "" + O.key), O) Z.call(O, le) && !Y.hasOwnProperty(le) && (ye[le] = O[le]);
    var _e = arguments.length - 2;
    if (_e === 1) ye.children = S;
    else if (1 < _e) {
      for (var Ne = Array(_e), Be = 0; Be < _e; Be++) Ne[Be] = arguments[Be + 2];
      ye.children = Ne;
    }
    if (_ && _.defaultProps) for (le in _e = _.defaultProps, _e) ye[le] === void 0 && (ye[le] = _e[le]);
    return { $$typeof: e, type: _, key: he, ref: Re, props: ye, _owner: j.current };
  }
  function re(_, O) {
    return { $$typeof: e, type: _.type, key: O, ref: _.ref, props: _.props, _owner: _._owner };
  }
  function I(_) {
    return typeof _ == "object" && _ !== null && _.$$typeof === e;
  }
  function te(_) {
    var O = { "=": "=0", ":": "=2" };
    return "$" + _.replace(/[=:]/g, function(S) {
      return O[S];
    });
  }
  var ie = /\/+/g;
  function xe(_, O) {
    return typeof _ == "object" && _ !== null && _.key != null ? te("" + _.key) : O.toString(36);
  }
  function oe(_, O, S, le, ye) {
    var he = typeof _;
    (he === "undefined" || he === "boolean") && (_ = null);
    var Re = !1;
    if (_ === null) Re = !0;
    else switch (he) {
      case "string":
      case "number":
        Re = !0;
        break;
      case "object":
        switch (_.$$typeof) {
          case e:
          case r:
            Re = !0;
        }
    }
    if (Re) return Re = _, ye = ye(Re), _ = le === "" ? "." + xe(Re, 0) : le, ne(ye) ? (S = "", _ != null && (S = _.replace(ie, "$&/") + "/"), oe(ye, O, S, "", function(Be) {
      return Be;
    })) : ye != null && (I(ye) && (ye = re(ye, S + (!ye.key || Re && Re.key === ye.key ? "" : ("" + ye.key).replace(ie, "$&/") + "/") + _)), O.push(ye)), 1;
    if (Re = 0, le = le === "" ? "." : le + ":", ne(_)) for (var _e = 0; _e < _.length; _e++) {
      he = _[_e];
      var Ne = le + xe(he, _e);
      Re += oe(he, O, S, Ne, ye);
    }
    else if (Ne = w(_), typeof Ne == "function") for (_ = Ne.call(_), _e = 0; !(he = _.next()).done; ) he = he.value, Ne = le + xe(he, _e++), Re += oe(he, O, S, Ne, ye);
    else if (he === "object") throw O = String(_), Error("Objects are not valid as a React child (found: " + (O === "[object Object]" ? "object with keys {" + Object.keys(_).join(", ") + "}" : O) + "). If you meant to render a collection of children, use an array instead.");
    return Re;
  }
  function X(_, O, S) {
    if (_ == null) return _;
    var le = [], ye = 0;
    return oe(_, le, "", "", function(he) {
      return O.call(S, he, ye++);
    }), le;
  }
  function ge(_) {
    if (_._status === -1) {
      var O = _._result;
      O = O(), O.then(function(S) {
        (_._status === 0 || _._status === -1) && (_._status = 1, _._result = S);
      }, function(S) {
        (_._status === 0 || _._status === -1) && (_._status = 2, _._result = S);
      }), _._status === -1 && (_._status = 0, _._result = O);
    }
    if (_._status === 1) return _._result.default;
    throw _._result;
  }
  var Ce = { current: null }, q = { transition: null }, N = { ReactCurrentDispatcher: Ce, ReactCurrentBatchConfig: q, ReactCurrentOwner: j };
  function b() {
    throw Error("act(...) is not supported in production builds of React.");
  }
  return ze.Children = { map: X, forEach: function(_, O, S) {
    X(_, function() {
      O.apply(this, arguments);
    }, S);
  }, count: function(_) {
    var O = 0;
    return X(_, function() {
      O++;
    }), O;
  }, toArray: function(_) {
    return X(_, function(O) {
      return O;
    }) || [];
  }, only: function(_) {
    if (!I(_)) throw Error("React.Children.only expected to receive a single React element child.");
    return _;
  } }, ze.Component = D, ze.Fragment = i, ze.Profiler = a, ze.PureComponent = U, ze.StrictMode = o, ze.Suspense = p, ze.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = N, ze.act = b, ze.cloneElement = function(_, O, S) {
    if (_ == null) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + _ + ".");
    var le = E({}, _.props), ye = _.key, he = _.ref, Re = _._owner;
    if (O != null) {
      if (O.ref !== void 0 && (he = O.ref, Re = j.current), O.key !== void 0 && (ye = "" + O.key), _.type && _.type.defaultProps) var _e = _.type.defaultProps;
      for (Ne in O) Z.call(O, Ne) && !Y.hasOwnProperty(Ne) && (le[Ne] = O[Ne] === void 0 && _e !== void 0 ? _e[Ne] : O[Ne]);
    }
    var Ne = arguments.length - 2;
    if (Ne === 1) le.children = S;
    else if (1 < Ne) {
      _e = Array(Ne);
      for (var Be = 0; Be < Ne; Be++) _e[Be] = arguments[Be + 2];
      le.children = _e;
    }
    return { $$typeof: e, type: _.type, key: ye, ref: he, props: le, _owner: Re };
  }, ze.createContext = function(_) {
    return _ = { $$typeof: c, _currentValue: _, _currentValue2: _, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null }, _.Provider = { $$typeof: s, _context: _ }, _.Consumer = _;
  }, ze.createElement = se, ze.createFactory = function(_) {
    var O = se.bind(null, _);
    return O.type = _, O;
  }, ze.createRef = function() {
    return { current: null };
  }, ze.forwardRef = function(_) {
    return { $$typeof: d, render: _ };
  }, ze.isValidElement = I, ze.lazy = function(_) {
    return { $$typeof: m, _payload: { _status: -1, _result: _ }, _init: ge };
  }, ze.memo = function(_, O) {
    return { $$typeof: h, type: _, compare: O === void 0 ? null : O };
  }, ze.startTransition = function(_) {
    var O = q.transition;
    q.transition = {};
    try {
      _();
    } finally {
      q.transition = O;
    }
  }, ze.unstable_act = b, ze.useCallback = function(_, O) {
    return Ce.current.useCallback(_, O);
  }, ze.useContext = function(_) {
    return Ce.current.useContext(_);
  }, ze.useDebugValue = function() {
  }, ze.useDeferredValue = function(_) {
    return Ce.current.useDeferredValue(_);
  }, ze.useEffect = function(_, O) {
    return Ce.current.useEffect(_, O);
  }, ze.useId = function() {
    return Ce.current.useId();
  }, ze.useImperativeHandle = function(_, O, S) {
    return Ce.current.useImperativeHandle(_, O, S);
  }, ze.useInsertionEffect = function(_, O) {
    return Ce.current.useInsertionEffect(_, O);
  }, ze.useLayoutEffect = function(_, O) {
    return Ce.current.useLayoutEffect(_, O);
  }, ze.useMemo = function(_, O) {
    return Ce.current.useMemo(_, O);
  }, ze.useReducer = function(_, O, S) {
    return Ce.current.useReducer(_, O, S);
  }, ze.useRef = function(_) {
    return Ce.current.useRef(_);
  }, ze.useState = function(_) {
    return Ce.current.useState(_);
  }, ze.useSyncExternalStore = function(_, O, S) {
    return Ce.current.useSyncExternalStore(_, O, S);
  }, ze.useTransition = function() {
    return Ce.current.useTransition();
  }, ze.version = "18.3.1", ze;
}
var Lf;
function vu() {
  return Lf || (Lf = 1, _s.exports = Sy()), _s.exports;
}
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Nf;
function Cy() {
  if (Nf) return qi;
  Nf = 1;
  var e = vu(), r = Symbol.for("react.element"), i = Symbol.for("react.fragment"), o = Object.prototype.hasOwnProperty, a = e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, s = { key: !0, ref: !0, __self: !0, __source: !0 };
  function c(d, p, h) {
    var m, v = {}, w = null, x = null;
    h !== void 0 && (w = "" + h), p.key !== void 0 && (w = "" + p.key), p.ref !== void 0 && (x = p.ref);
    for (m in p) o.call(p, m) && !s.hasOwnProperty(m) && (v[m] = p[m]);
    if (d && d.defaultProps) for (m in p = d.defaultProps, p) v[m] === void 0 && (v[m] = p[m]);
    return { $$typeof: r, type: d, key: w, ref: x, props: v, _owner: a.current };
  }
  return qi.Fragment = i, qi.jsx = c, qi.jsxs = c, qi;
}
var Af;
function Ey() {
  return Af || (Af = 1, Es.exports = Cy()), Es.exports;
}
var y = Ey(), vl = {}, Ts = { exports: {} }, At = {}, js = { exports: {} }, Rs = {};
/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var zf;
function _y() {
  return zf || (zf = 1, (function(e) {
    function r(q, N) {
      var b = q.length;
      q.push(N);
      e: for (; 0 < b; ) {
        var _ = b - 1 >>> 1, O = q[_];
        if (0 < a(O, N)) q[_] = N, q[b] = O, b = _;
        else break e;
      }
    }
    function i(q) {
      return q.length === 0 ? null : q[0];
    }
    function o(q) {
      if (q.length === 0) return null;
      var N = q[0], b = q.pop();
      if (b !== N) {
        q[0] = b;
        e: for (var _ = 0, O = q.length, S = O >>> 1; _ < S; ) {
          var le = 2 * (_ + 1) - 1, ye = q[le], he = le + 1, Re = q[he];
          if (0 > a(ye, b)) he < O && 0 > a(Re, ye) ? (q[_] = Re, q[he] = b, _ = he) : (q[_] = ye, q[le] = b, _ = le);
          else if (he < O && 0 > a(Re, b)) q[_] = Re, q[he] = b, _ = he;
          else break e;
        }
      }
      return N;
    }
    function a(q, N) {
      var b = q.sortIndex - N.sortIndex;
      return b !== 0 ? b : q.id - N.id;
    }
    if (typeof performance == "object" && typeof performance.now == "function") {
      var s = performance;
      e.unstable_now = function() {
        return s.now();
      };
    } else {
      var c = Date, d = c.now();
      e.unstable_now = function() {
        return c.now() - d;
      };
    }
    var p = [], h = [], m = 1, v = null, w = 3, x = !1, E = !1, L = !1, D = typeof setTimeout == "function" ? setTimeout : null, z = typeof clearTimeout == "function" ? clearTimeout : null, U = typeof setImmediate < "u" ? setImmediate : null;
    typeof navigator < "u" && navigator.scheduling !== void 0 && navigator.scheduling.isInputPending !== void 0 && navigator.scheduling.isInputPending.bind(navigator.scheduling);
    function B(q) {
      for (var N = i(h); N !== null; ) {
        if (N.callback === null) o(h);
        else if (N.startTime <= q) o(h), N.sortIndex = N.expirationTime, r(p, N);
        else break;
        N = i(h);
      }
    }
    function ne(q) {
      if (L = !1, B(q), !E) if (i(p) !== null) E = !0, ge(Z);
      else {
        var N = i(h);
        N !== null && Ce(ne, N.startTime - q);
      }
    }
    function Z(q, N) {
      E = !1, L && (L = !1, z(se), se = -1), x = !0;
      var b = w;
      try {
        for (B(N), v = i(p); v !== null && (!(v.expirationTime > N) || q && !te()); ) {
          var _ = v.callback;
          if (typeof _ == "function") {
            v.callback = null, w = v.priorityLevel;
            var O = _(v.expirationTime <= N);
            N = e.unstable_now(), typeof O == "function" ? v.callback = O : v === i(p) && o(p), B(N);
          } else o(p);
          v = i(p);
        }
        if (v !== null) var S = !0;
        else {
          var le = i(h);
          le !== null && Ce(ne, le.startTime - N), S = !1;
        }
        return S;
      } finally {
        v = null, w = b, x = !1;
      }
    }
    var j = !1, Y = null, se = -1, re = 5, I = -1;
    function te() {
      return !(e.unstable_now() - I < re);
    }
    function ie() {
      if (Y !== null) {
        var q = e.unstable_now();
        I = q;
        var N = !0;
        try {
          N = Y(!0, q);
        } finally {
          N ? xe() : (j = !1, Y = null);
        }
      } else j = !1;
    }
    var xe;
    if (typeof U == "function") xe = function() {
      U(ie);
    };
    else if (typeof MessageChannel < "u") {
      var oe = new MessageChannel(), X = oe.port2;
      oe.port1.onmessage = ie, xe = function() {
        X.postMessage(null);
      };
    } else xe = function() {
      D(ie, 0);
    };
    function ge(q) {
      Y = q, j || (j = !0, xe());
    }
    function Ce(q, N) {
      se = D(function() {
        q(e.unstable_now());
      }, N);
    }
    e.unstable_IdlePriority = 5, e.unstable_ImmediatePriority = 1, e.unstable_LowPriority = 4, e.unstable_NormalPriority = 3, e.unstable_Profiling = null, e.unstable_UserBlockingPriority = 2, e.unstable_cancelCallback = function(q) {
      q.callback = null;
    }, e.unstable_continueExecution = function() {
      E || x || (E = !0, ge(Z));
    }, e.unstable_forceFrameRate = function(q) {
      0 > q || 125 < q ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : re = 0 < q ? Math.floor(1e3 / q) : 5;
    }, e.unstable_getCurrentPriorityLevel = function() {
      return w;
    }, e.unstable_getFirstCallbackNode = function() {
      return i(p);
    }, e.unstable_next = function(q) {
      switch (w) {
        case 1:
        case 2:
        case 3:
          var N = 3;
          break;
        default:
          N = w;
      }
      var b = w;
      w = N;
      try {
        return q();
      } finally {
        w = b;
      }
    }, e.unstable_pauseExecution = function() {
    }, e.unstable_requestPaint = function() {
    }, e.unstable_runWithPriority = function(q, N) {
      switch (q) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          q = 3;
      }
      var b = w;
      w = q;
      try {
        return N();
      } finally {
        w = b;
      }
    }, e.unstable_scheduleCallback = function(q, N, b) {
      var _ = e.unstable_now();
      switch (typeof b == "object" && b !== null ? (b = b.delay, b = typeof b == "number" && 0 < b ? _ + b : _) : b = _, q) {
        case 1:
          var O = -1;
          break;
        case 2:
          O = 250;
          break;
        case 5:
          O = 1073741823;
          break;
        case 4:
          O = 1e4;
          break;
        default:
          O = 5e3;
      }
      return O = b + O, q = { id: m++, callback: N, priorityLevel: q, startTime: b, expirationTime: O, sortIndex: -1 }, b > _ ? (q.sortIndex = b, r(h, q), i(p) === null && q === i(h) && (L ? (z(se), se = -1) : L = !0, Ce(ne, b - _))) : (q.sortIndex = O, r(p, q), E || x || (E = !0, ge(Z))), q;
    }, e.unstable_shouldYield = te, e.unstable_wrapCallback = function(q) {
      var N = w;
      return function() {
        var b = w;
        w = N;
        try {
          return q.apply(this, arguments);
        } finally {
          w = b;
        }
      };
    };
  })(Rs)), Rs;
}
var Pf;
function Ty() {
  return Pf || (Pf = 1, js.exports = _y()), js.exports;
}
/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var If;
function jy() {
  if (If) return At;
  If = 1;
  var e = vu(), r = Ty();
  function i(t) {
    for (var n = "https://reactjs.org/docs/error-decoder.html?invariant=" + t, l = 1; l < arguments.length; l++) n += "&args[]=" + encodeURIComponent(arguments[l]);
    return "Minified React error #" + t + "; visit " + n + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  var o = /* @__PURE__ */ new Set(), a = {};
  function s(t, n) {
    c(t, n), c(t + "Capture", n);
  }
  function c(t, n) {
    for (a[t] = n, t = 0; t < n.length; t++) o.add(n[t]);
  }
  var d = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u"), p = Object.prototype.hasOwnProperty, h = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/, m = {}, v = {};
  function w(t) {
    return p.call(v, t) ? !0 : p.call(m, t) ? !1 : h.test(t) ? v[t] = !0 : (m[t] = !0, !1);
  }
  function x(t, n, l, u) {
    if (l !== null && l.type === 0) return !1;
    switch (typeof n) {
      case "function":
      case "symbol":
        return !0;
      case "boolean":
        return u ? !1 : l !== null ? !l.acceptsBooleans : (t = t.toLowerCase().slice(0, 5), t !== "data-" && t !== "aria-");
      default:
        return !1;
    }
  }
  function E(t, n, l, u) {
    if (n === null || typeof n > "u" || x(t, n, l, u)) return !0;
    if (u) return !1;
    if (l !== null) switch (l.type) {
      case 3:
        return !n;
      case 4:
        return n === !1;
      case 5:
        return isNaN(n);
      case 6:
        return isNaN(n) || 1 > n;
    }
    return !1;
  }
  function L(t, n, l, u, f, g, k) {
    this.acceptsBooleans = n === 2 || n === 3 || n === 4, this.attributeName = u, this.attributeNamespace = f, this.mustUseProperty = l, this.propertyName = t, this.type = n, this.sanitizeURL = g, this.removeEmptyString = k;
  }
  var D = {};
  "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t) {
    D[t] = new L(t, 0, !1, t, null, !1, !1);
  }), [["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(t) {
    var n = t[0];
    D[n] = new L(n, 1, !1, t[1], null, !1, !1);
  }), ["contentEditable", "draggable", "spellCheck", "value"].forEach(function(t) {
    D[t] = new L(t, 2, !1, t.toLowerCase(), null, !1, !1);
  }), ["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(t) {
    D[t] = new L(t, 2, !1, t, null, !1, !1);
  }), "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t) {
    D[t] = new L(t, 3, !1, t.toLowerCase(), null, !1, !1);
  }), ["checked", "multiple", "muted", "selected"].forEach(function(t) {
    D[t] = new L(t, 3, !0, t, null, !1, !1);
  }), ["capture", "download"].forEach(function(t) {
    D[t] = new L(t, 4, !1, t, null, !1, !1);
  }), ["cols", "rows", "size", "span"].forEach(function(t) {
    D[t] = new L(t, 6, !1, t, null, !1, !1);
  }), ["rowSpan", "start"].forEach(function(t) {
    D[t] = new L(t, 5, !1, t.toLowerCase(), null, !1, !1);
  });
  var z = /[\-:]([a-z])/g;
  function U(t) {
    return t[1].toUpperCase();
  }
  "accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t) {
    var n = t.replace(
      z,
      U
    );
    D[n] = new L(n, 1, !1, t, null, !1, !1);
  }), "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t) {
    var n = t.replace(z, U);
    D[n] = new L(n, 1, !1, t, "http://www.w3.org/1999/xlink", !1, !1);
  }), ["xml:base", "xml:lang", "xml:space"].forEach(function(t) {
    var n = t.replace(z, U);
    D[n] = new L(n, 1, !1, t, "http://www.w3.org/XML/1998/namespace", !1, !1);
  }), ["tabIndex", "crossOrigin"].forEach(function(t) {
    D[t] = new L(t, 1, !1, t.toLowerCase(), null, !1, !1);
  }), D.xlinkHref = new L("xlinkHref", 1, !1, "xlink:href", "http://www.w3.org/1999/xlink", !0, !1), ["src", "href", "action", "formAction"].forEach(function(t) {
    D[t] = new L(t, 1, !1, t.toLowerCase(), null, !0, !0);
  });
  function B(t, n, l, u) {
    var f = D.hasOwnProperty(n) ? D[n] : null;
    (f !== null ? f.type !== 0 : u || !(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") && (E(n, l, f, u) && (l = null), u || f === null ? w(n) && (l === null ? t.removeAttribute(n) : t.setAttribute(n, "" + l)) : f.mustUseProperty ? t[f.propertyName] = l === null ? f.type === 3 ? !1 : "" : l : (n = f.attributeName, u = f.attributeNamespace, l === null ? t.removeAttribute(n) : (f = f.type, l = f === 3 || f === 4 && l === !0 ? "" : "" + l, u ? t.setAttributeNS(u, n, l) : t.setAttribute(n, l))));
  }
  var ne = e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, Z = Symbol.for("react.element"), j = Symbol.for("react.portal"), Y = Symbol.for("react.fragment"), se = Symbol.for("react.strict_mode"), re = Symbol.for("react.profiler"), I = Symbol.for("react.provider"), te = Symbol.for("react.context"), ie = Symbol.for("react.forward_ref"), xe = Symbol.for("react.suspense"), oe = Symbol.for("react.suspense_list"), X = Symbol.for("react.memo"), ge = Symbol.for("react.lazy"), Ce = Symbol.for("react.offscreen"), q = Symbol.iterator;
  function N(t) {
    return t === null || typeof t != "object" ? null : (t = q && t[q] || t["@@iterator"], typeof t == "function" ? t : null);
  }
  var b = Object.assign, _;
  function O(t) {
    if (_ === void 0) try {
      throw Error();
    } catch (l) {
      var n = l.stack.trim().match(/\n( *(at )?)/);
      _ = n && n[1] || "";
    }
    return `
` + _ + t;
  }
  var S = !1;
  function le(t, n) {
    if (!t || S) return "";
    S = !0;
    var l = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      if (n) if (n = function() {
        throw Error();
      }, Object.defineProperty(n.prototype, "props", { set: function() {
        throw Error();
      } }), typeof Reflect == "object" && Reflect.construct) {
        try {
          Reflect.construct(n, []);
        } catch (M) {
          var u = M;
        }
        Reflect.construct(t, [], n);
      } else {
        try {
          n.call();
        } catch (M) {
          u = M;
        }
        t.call(n.prototype);
      }
      else {
        try {
          throw Error();
        } catch (M) {
          u = M;
        }
        t();
      }
    } catch (M) {
      if (M && u && typeof M.stack == "string") {
        for (var f = M.stack.split(`
`), g = u.stack.split(`
`), k = f.length - 1, C = g.length - 1; 1 <= k && 0 <= C && f[k] !== g[C]; ) C--;
        for (; 1 <= k && 0 <= C; k--, C--) if (f[k] !== g[C]) {
          if (k !== 1 || C !== 1)
            do
              if (k--, C--, 0 > C || f[k] !== g[C]) {
                var T = `
` + f[k].replace(" at new ", " at ");
                return t.displayName && T.includes("<anonymous>") && (T = T.replace("<anonymous>", t.displayName)), T;
              }
            while (1 <= k && 0 <= C);
          break;
        }
      }
    } finally {
      S = !1, Error.prepareStackTrace = l;
    }
    return (t = t ? t.displayName || t.name : "") ? O(t) : "";
  }
  function ye(t) {
    switch (t.tag) {
      case 5:
        return O(t.type);
      case 16:
        return O("Lazy");
      case 13:
        return O("Suspense");
      case 19:
        return O("SuspenseList");
      case 0:
      case 2:
      case 15:
        return t = le(t.type, !1), t;
      case 11:
        return t = le(t.type.render, !1), t;
      case 1:
        return t = le(t.type, !0), t;
      default:
        return "";
    }
  }
  function he(t) {
    if (t == null) return null;
    if (typeof t == "function") return t.displayName || t.name || null;
    if (typeof t == "string") return t;
    switch (t) {
      case Y:
        return "Fragment";
      case j:
        return "Portal";
      case re:
        return "Profiler";
      case se:
        return "StrictMode";
      case xe:
        return "Suspense";
      case oe:
        return "SuspenseList";
    }
    if (typeof t == "object") switch (t.$$typeof) {
      case te:
        return (t.displayName || "Context") + ".Consumer";
      case I:
        return (t._context.displayName || "Context") + ".Provider";
      case ie:
        var n = t.render;
        return t = t.displayName, t || (t = n.displayName || n.name || "", t = t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef"), t;
      case X:
        return n = t.displayName || null, n !== null ? n : he(t.type) || "Memo";
      case ge:
        n = t._payload, t = t._init;
        try {
          return he(t(n));
        } catch {
        }
    }
    return null;
  }
  function Re(t) {
    var n = t.type;
    switch (t.tag) {
      case 24:
        return "Cache";
      case 9:
        return (n.displayName || "Context") + ".Consumer";
      case 10:
        return (n._context.displayName || "Context") + ".Provider";
      case 18:
        return "DehydratedFragment";
      case 11:
        return t = n.render, t = t.displayName || t.name || "", n.displayName || (t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef");
      case 7:
        return "Fragment";
      case 5:
        return n;
      case 4:
        return "Portal";
      case 3:
        return "Root";
      case 6:
        return "Text";
      case 16:
        return he(n);
      case 8:
        return n === se ? "StrictMode" : "Mode";
      case 22:
        return "Offscreen";
      case 12:
        return "Profiler";
      case 21:
        return "Scope";
      case 13:
        return "Suspense";
      case 19:
        return "SuspenseList";
      case 25:
        return "TracingMarker";
      case 1:
      case 0:
      case 17:
      case 2:
      case 14:
      case 15:
        if (typeof n == "function") return n.displayName || n.name || null;
        if (typeof n == "string") return n;
    }
    return null;
  }
  function _e(t) {
    switch (typeof t) {
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return t;
      case "object":
        return t;
      default:
        return "";
    }
  }
  function Ne(t) {
    var n = t.type;
    return (t = t.nodeName) && t.toLowerCase() === "input" && (n === "checkbox" || n === "radio");
  }
  function Be(t) {
    var n = Ne(t) ? "checked" : "value", l = Object.getOwnPropertyDescriptor(t.constructor.prototype, n), u = "" + t[n];
    if (!t.hasOwnProperty(n) && typeof l < "u" && typeof l.get == "function" && typeof l.set == "function") {
      var f = l.get, g = l.set;
      return Object.defineProperty(t, n, { configurable: !0, get: function() {
        return f.call(this);
      }, set: function(k) {
        u = "" + k, g.call(this, k);
      } }), Object.defineProperty(t, n, { enumerable: l.enumerable }), { getValue: function() {
        return u;
      }, setValue: function(k) {
        u = "" + k;
      }, stopTracking: function() {
        t._valueTracker = null, delete t[n];
      } };
    }
  }
  function He(t) {
    t._valueTracker || (t._valueTracker = Be(t));
  }
  function Sn(t) {
    if (!t) return !1;
    var n = t._valueTracker;
    if (!n) return !0;
    var l = n.getValue(), u = "";
    return t && (u = Ne(t) ? t.checked ? "true" : "false" : t.value), t = u, t !== l ? (n.setValue(t), !0) : !1;
  }
  function W(t) {
    if (t = t || (typeof document < "u" ? document : void 0), typeof t > "u") return null;
    try {
      return t.activeElement || t.body;
    } catch {
      return t.body;
    }
  }
  function Ae(t, n) {
    var l = n.checked;
    return b({}, n, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: l ?? t._wrapperState.initialChecked });
  }
  function Ue(t, n) {
    var l = n.defaultValue == null ? "" : n.defaultValue, u = n.checked != null ? n.checked : n.defaultChecked;
    l = _e(n.value != null ? n.value : l), t._wrapperState = { initialChecked: u, initialValue: l, controlled: n.type === "checkbox" || n.type === "radio" ? n.checked != null : n.value != null };
  }
  function We(t, n) {
    n = n.checked, n != null && B(t, "checked", n, !1);
  }
  function Jt(t, n) {
    We(t, n);
    var l = _e(n.value), u = n.type;
    if (l != null) u === "number" ? (l === 0 && t.value === "" || t.value != l) && (t.value = "" + l) : t.value !== "" + l && (t.value = "" + l);
    else if (u === "submit" || u === "reset") {
      t.removeAttribute("value");
      return;
    }
    n.hasOwnProperty("value") ? dt(t, n.type, l) : n.hasOwnProperty("defaultValue") && dt(t, n.type, _e(n.defaultValue)), n.checked == null && n.defaultChecked != null && (t.defaultChecked = !!n.defaultChecked);
  }
  function jr(t, n, l) {
    if (n.hasOwnProperty("value") || n.hasOwnProperty("defaultValue")) {
      var u = n.type;
      if (!(u !== "submit" && u !== "reset" || n.value !== void 0 && n.value !== null)) return;
      n = "" + t._wrapperState.initialValue, l || n === t.value || (t.value = n), t.defaultValue = n;
    }
    l = t.name, l !== "" && (t.name = ""), t.defaultChecked = !!t._wrapperState.initialChecked, l !== "" && (t.name = l);
  }
  function dt(t, n, l) {
    (n !== "number" || W(t.ownerDocument) !== t) && (l == null ? t.defaultValue = "" + t._wrapperState.initialValue : t.defaultValue !== "" + l && (t.defaultValue = "" + l));
  }
  var sn = Array.isArray;
  function un(t, n, l, u) {
    if (t = t.options, n) {
      n = {};
      for (var f = 0; f < l.length; f++) n["$" + l[f]] = !0;
      for (l = 0; l < t.length; l++) f = n.hasOwnProperty("$" + t[l].value), t[l].selected !== f && (t[l].selected = f), f && u && (t[l].defaultSelected = !0);
    } else {
      for (l = "" + _e(l), n = null, f = 0; f < t.length; f++) {
        if (t[f].value === l) {
          t[f].selected = !0, u && (t[f].defaultSelected = !0);
          return;
        }
        n !== null || t[f].disabled || (n = t[f]);
      }
      n !== null && (n.selected = !0);
    }
  }
  function cn(t, n) {
    if (n.dangerouslySetInnerHTML != null) throw Error(i(91));
    return b({}, n, { value: void 0, defaultValue: void 0, children: "" + t._wrapperState.initialValue });
  }
  function dn(t, n) {
    var l = n.value;
    if (l == null) {
      if (l = n.children, n = n.defaultValue, l != null) {
        if (n != null) throw Error(i(92));
        if (sn(l)) {
          if (1 < l.length) throw Error(i(93));
          l = l[0];
        }
        n = l;
      }
      n == null && (n = ""), l = n;
    }
    t._wrapperState = { initialValue: _e(l) };
  }
  function fn(t, n) {
    var l = _e(n.value), u = _e(n.defaultValue);
    l != null && (l = "" + l, l !== t.value && (t.value = l), n.defaultValue == null && t.defaultValue !== l && (t.defaultValue = l)), u != null && (t.defaultValue = "" + u);
  }
  function Cn(t) {
    var n = t.textContent;
    n === t._wrapperState.initialValue && n !== "" && n !== null && (t.value = n);
  }
  function H(t) {
    switch (t) {
      case "svg":
        return "http://www.w3.org/2000/svg";
      case "math":
        return "http://www.w3.org/1998/Math/MathML";
      default:
        return "http://www.w3.org/1999/xhtml";
    }
  }
  function ee(t, n) {
    return t == null || t === "http://www.w3.org/1999/xhtml" ? H(n) : t === "http://www.w3.org/2000/svg" && n === "foreignObject" ? "http://www.w3.org/1999/xhtml" : t;
  }
  var ve, Le = (function(t) {
    return typeof MSApp < "u" && MSApp.execUnsafeLocalFunction ? function(n, l, u, f) {
      MSApp.execUnsafeLocalFunction(function() {
        return t(n, l, u, f);
      });
    } : t;
  })(function(t, n) {
    if (t.namespaceURI !== "http://www.w3.org/2000/svg" || "innerHTML" in t) t.innerHTML = n;
    else {
      for (ve = ve || document.createElement("div"), ve.innerHTML = "<svg>" + n.valueOf().toString() + "</svg>", n = ve.firstChild; t.firstChild; ) t.removeChild(t.firstChild);
      for (; n.firstChild; ) t.appendChild(n.firstChild);
    }
  });
  function De(t, n) {
    if (n) {
      var l = t.firstChild;
      if (l && l === t.lastChild && l.nodeType === 3) {
        l.nodeValue = n;
        return;
      }
    }
    t.textContent = n;
  }
  var Ke = {
    animationIterationCount: !0,
    aspectRatio: !0,
    borderImageOutset: !0,
    borderImageSlice: !0,
    borderImageWidth: !0,
    boxFlex: !0,
    boxFlexGroup: !0,
    boxOrdinalGroup: !0,
    columnCount: !0,
    columns: !0,
    flex: !0,
    flexGrow: !0,
    flexPositive: !0,
    flexShrink: !0,
    flexNegative: !0,
    flexOrder: !0,
    gridArea: !0,
    gridRow: !0,
    gridRowEnd: !0,
    gridRowSpan: !0,
    gridRowStart: !0,
    gridColumn: !0,
    gridColumnEnd: !0,
    gridColumnSpan: !0,
    gridColumnStart: !0,
    fontWeight: !0,
    lineClamp: !0,
    lineHeight: !0,
    opacity: !0,
    order: !0,
    orphans: !0,
    tabSize: !0,
    widows: !0,
    zIndex: !0,
    zoom: !0,
    fillOpacity: !0,
    floodOpacity: !0,
    stopOpacity: !0,
    strokeDasharray: !0,
    strokeDashoffset: !0,
    strokeMiterlimit: !0,
    strokeOpacity: !0,
    strokeWidth: !0
  }, Bt = ["Webkit", "ms", "Moz", "O"];
  Object.keys(Ke).forEach(function(t) {
    Bt.forEach(function(n) {
      n = n + t.charAt(0).toUpperCase() + t.substring(1), Ke[n] = Ke[t];
    });
  });
  function St(t, n, l) {
    return n == null || typeof n == "boolean" || n === "" ? "" : l || typeof n != "number" || n === 0 || Ke.hasOwnProperty(t) && Ke[t] ? ("" + n).trim() : n + "px";
  }
  function ke(t, n) {
    t = t.style;
    for (var l in n) if (n.hasOwnProperty(l)) {
      var u = l.indexOf("--") === 0, f = St(l, n[l], u);
      l === "float" && (l = "cssFloat"), u ? t.setProperty(l, f) : t[l] = f;
    }
  }
  var fe = b({ menuitem: !0 }, { area: !0, base: !0, br: !0, col: !0, embed: !0, hr: !0, img: !0, input: !0, keygen: !0, link: !0, meta: !0, param: !0, source: !0, track: !0, wbr: !0 });
  function Ee(t, n) {
    if (n) {
      if (fe[t] && (n.children != null || n.dangerouslySetInnerHTML != null)) throw Error(i(137, t));
      if (n.dangerouslySetInnerHTML != null) {
        if (n.children != null) throw Error(i(60));
        if (typeof n.dangerouslySetInnerHTML != "object" || !("__html" in n.dangerouslySetInnerHTML)) throw Error(i(61));
      }
      if (n.style != null && typeof n.style != "object") throw Error(i(62));
    }
  }
  function it(t, n) {
    if (t.indexOf("-") === -1) return typeof n.is == "string";
    switch (t) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var tt = null;
  function Rr(t) {
    return t = t.target || t.srcElement || window, t.correspondingUseElement && (t = t.correspondingUseElement), t.nodeType === 3 ? t.parentNode : t;
  }
  var Bl = null, Lr = null, Nr = null;
  function Wu(t) {
    if (t = ji(t)) {
      if (typeof Bl != "function") throw Error(i(280));
      var n = t.stateNode;
      n && (n = zo(n), Bl(t.stateNode, t.type, n));
    }
  }
  function Vu(t) {
    Lr ? Nr ? Nr.push(t) : Nr = [t] : Lr = t;
  }
  function Gu() {
    if (Lr) {
      var t = Lr, n = Nr;
      if (Nr = Lr = null, Wu(t), n) for (t = 0; t < n.length; t++) Wu(n[t]);
    }
  }
  function Qu(t, n) {
    return t(n);
  }
  function Ku() {
  }
  var Hl = !1;
  function Yu(t, n, l) {
    if (Hl) return t(n, l);
    Hl = !0;
    try {
      return Qu(t, n, l);
    } finally {
      Hl = !1, (Lr !== null || Nr !== null) && (Ku(), Gu());
    }
  }
  function ai(t, n) {
    var l = t.stateNode;
    if (l === null) return null;
    var u = zo(l);
    if (u === null) return null;
    l = u[n];
    e: switch (n) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        (u = !u.disabled) || (t = t.type, u = !(t === "button" || t === "input" || t === "select" || t === "textarea")), t = !u;
        break e;
      default:
        t = !1;
    }
    if (t) return null;
    if (l && typeof l != "function") throw Error(i(231, n, typeof l));
    return l;
  }
  var ql = !1;
  if (d) try {
    var si = {};
    Object.defineProperty(si, "passive", { get: function() {
      ql = !0;
    } }), window.addEventListener("test", si, si), window.removeEventListener("test", si, si);
  } catch {
    ql = !1;
  }
  function Rm(t, n, l, u, f, g, k, C, T) {
    var M = Array.prototype.slice.call(arguments, 3);
    try {
      n.apply(l, M);
    } catch (G) {
      this.onError(G);
    }
  }
  var ui = !1, co = null, fo = !1, Ul = null, Lm = { onError: function(t) {
    ui = !0, co = t;
  } };
  function Nm(t, n, l, u, f, g, k, C, T) {
    ui = !1, co = null, Rm.apply(Lm, arguments);
  }
  function Am(t, n, l, u, f, g, k, C, T) {
    if (Nm.apply(this, arguments), ui) {
      if (ui) {
        var M = co;
        ui = !1, co = null;
      } else throw Error(i(198));
      fo || (fo = !0, Ul = M);
    }
  }
  function ur(t) {
    var n = t, l = t;
    if (t.alternate) for (; n.return; ) n = n.return;
    else {
      t = n;
      do
        n = t, (n.flags & 4098) !== 0 && (l = n.return), t = n.return;
      while (t);
    }
    return n.tag === 3 ? l : null;
  }
  function Xu(t) {
    if (t.tag === 13) {
      var n = t.memoizedState;
      if (n === null && (t = t.alternate, t !== null && (n = t.memoizedState)), n !== null) return n.dehydrated;
    }
    return null;
  }
  function Ju(t) {
    if (ur(t) !== t) throw Error(i(188));
  }
  function zm(t) {
    var n = t.alternate;
    if (!n) {
      if (n = ur(t), n === null) throw Error(i(188));
      return n !== t ? null : t;
    }
    for (var l = t, u = n; ; ) {
      var f = l.return;
      if (f === null) break;
      var g = f.alternate;
      if (g === null) {
        if (u = f.return, u !== null) {
          l = u;
          continue;
        }
        break;
      }
      if (f.child === g.child) {
        for (g = f.child; g; ) {
          if (g === l) return Ju(f), t;
          if (g === u) return Ju(f), n;
          g = g.sibling;
        }
        throw Error(i(188));
      }
      if (l.return !== u.return) l = f, u = g;
      else {
        for (var k = !1, C = f.child; C; ) {
          if (C === l) {
            k = !0, l = f, u = g;
            break;
          }
          if (C === u) {
            k = !0, u = f, l = g;
            break;
          }
          C = C.sibling;
        }
        if (!k) {
          for (C = g.child; C; ) {
            if (C === l) {
              k = !0, l = g, u = f;
              break;
            }
            if (C === u) {
              k = !0, u = g, l = f;
              break;
            }
            C = C.sibling;
          }
          if (!k) throw Error(i(189));
        }
      }
      if (l.alternate !== u) throw Error(i(190));
    }
    if (l.tag !== 3) throw Error(i(188));
    return l.stateNode.current === l ? t : n;
  }
  function Zu(t) {
    return t = zm(t), t !== null ? ec(t) : null;
  }
  function ec(t) {
    if (t.tag === 5 || t.tag === 6) return t;
    for (t = t.child; t !== null; ) {
      var n = ec(t);
      if (n !== null) return n;
      t = t.sibling;
    }
    return null;
  }
  var tc = r.unstable_scheduleCallback, nc = r.unstable_cancelCallback, Pm = r.unstable_shouldYield, Im = r.unstable_requestPaint, ot = r.unstable_now, Dm = r.unstable_getCurrentPriorityLevel, Wl = r.unstable_ImmediatePriority, rc = r.unstable_UserBlockingPriority, po = r.unstable_NormalPriority, Mm = r.unstable_LowPriority, ic = r.unstable_IdlePriority, ho = null, pn = null;
  function Om(t) {
    if (pn && typeof pn.onCommitFiberRoot == "function") try {
      pn.onCommitFiberRoot(ho, t, void 0, (t.current.flags & 128) === 128);
    } catch {
    }
  }
  var Zt = Math.clz32 ? Math.clz32 : Bm, Fm = Math.log, $m = Math.LN2;
  function Bm(t) {
    return t >>>= 0, t === 0 ? 32 : 31 - (Fm(t) / $m | 0) | 0;
  }
  var mo = 64, go = 4194304;
  function ci(t) {
    switch (t & -t) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t & 4194240;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
      case 67108864:
        return t & 130023424;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 1073741824;
      default:
        return t;
    }
  }
  function yo(t, n) {
    var l = t.pendingLanes;
    if (l === 0) return 0;
    var u = 0, f = t.suspendedLanes, g = t.pingedLanes, k = l & 268435455;
    if (k !== 0) {
      var C = k & ~f;
      C !== 0 ? u = ci(C) : (g &= k, g !== 0 && (u = ci(g)));
    } else k = l & ~f, k !== 0 ? u = ci(k) : g !== 0 && (u = ci(g));
    if (u === 0) return 0;
    if (n !== 0 && n !== u && (n & f) === 0 && (f = u & -u, g = n & -n, f >= g || f === 16 && (g & 4194240) !== 0)) return n;
    if ((u & 4) !== 0 && (u |= l & 16), n = t.entangledLanes, n !== 0) for (t = t.entanglements, n &= u; 0 < n; ) l = 31 - Zt(n), f = 1 << l, u |= t[l], n &= ~f;
    return u;
  }
  function Hm(t, n) {
    switch (t) {
      case 1:
      case 2:
      case 4:
        return n + 250;
      case 8:
      case 16:
      case 32:
      case 64:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return n + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
      case 67108864:
        return -1;
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function qm(t, n) {
    for (var l = t.suspendedLanes, u = t.pingedLanes, f = t.expirationTimes, g = t.pendingLanes; 0 < g; ) {
      var k = 31 - Zt(g), C = 1 << k, T = f[k];
      T === -1 ? ((C & l) === 0 || (C & u) !== 0) && (f[k] = Hm(C, n)) : T <= n && (t.expiredLanes |= C), g &= ~C;
    }
  }
  function Vl(t) {
    return t = t.pendingLanes & -1073741825, t !== 0 ? t : t & 1073741824 ? 1073741824 : 0;
  }
  function oc() {
    var t = mo;
    return mo <<= 1, (mo & 4194240) === 0 && (mo = 64), t;
  }
  function Gl(t) {
    for (var n = [], l = 0; 31 > l; l++) n.push(t);
    return n;
  }
  function di(t, n, l) {
    t.pendingLanes |= n, n !== 536870912 && (t.suspendedLanes = 0, t.pingedLanes = 0), t = t.eventTimes, n = 31 - Zt(n), t[n] = l;
  }
  function Um(t, n) {
    var l = t.pendingLanes & ~n;
    t.pendingLanes = n, t.suspendedLanes = 0, t.pingedLanes = 0, t.expiredLanes &= n, t.mutableReadLanes &= n, t.entangledLanes &= n, n = t.entanglements;
    var u = t.eventTimes;
    for (t = t.expirationTimes; 0 < l; ) {
      var f = 31 - Zt(l), g = 1 << f;
      n[f] = 0, u[f] = -1, t[f] = -1, l &= ~g;
    }
  }
  function Ql(t, n) {
    var l = t.entangledLanes |= n;
    for (t = t.entanglements; l; ) {
      var u = 31 - Zt(l), f = 1 << u;
      f & n | t[u] & n && (t[u] |= n), l &= ~f;
    }
  }
  var qe = 0;
  function lc(t) {
    return t &= -t, 1 < t ? 4 < t ? (t & 268435455) !== 0 ? 16 : 536870912 : 4 : 1;
  }
  var ac, Kl, sc, uc, cc, Yl = !1, vo = [], On = null, Fn = null, $n = null, fi = /* @__PURE__ */ new Map(), pi = /* @__PURE__ */ new Map(), Bn = [], Wm = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
  function dc(t, n) {
    switch (t) {
      case "focusin":
      case "focusout":
        On = null;
        break;
      case "dragenter":
      case "dragleave":
        Fn = null;
        break;
      case "mouseover":
      case "mouseout":
        $n = null;
        break;
      case "pointerover":
      case "pointerout":
        fi.delete(n.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        pi.delete(n.pointerId);
    }
  }
  function hi(t, n, l, u, f, g) {
    return t === null || t.nativeEvent !== g ? (t = { blockedOn: n, domEventName: l, eventSystemFlags: u, nativeEvent: g, targetContainers: [f] }, n !== null && (n = ji(n), n !== null && Kl(n)), t) : (t.eventSystemFlags |= u, n = t.targetContainers, f !== null && n.indexOf(f) === -1 && n.push(f), t);
  }
  function Vm(t, n, l, u, f) {
    switch (n) {
      case "focusin":
        return On = hi(On, t, n, l, u, f), !0;
      case "dragenter":
        return Fn = hi(Fn, t, n, l, u, f), !0;
      case "mouseover":
        return $n = hi($n, t, n, l, u, f), !0;
      case "pointerover":
        var g = f.pointerId;
        return fi.set(g, hi(fi.get(g) || null, t, n, l, u, f)), !0;
      case "gotpointercapture":
        return g = f.pointerId, pi.set(g, hi(pi.get(g) || null, t, n, l, u, f)), !0;
    }
    return !1;
  }
  function fc(t) {
    var n = cr(t.target);
    if (n !== null) {
      var l = ur(n);
      if (l !== null) {
        if (n = l.tag, n === 13) {
          if (n = Xu(l), n !== null) {
            t.blockedOn = n, cc(t.priority, function() {
              sc(l);
            });
            return;
          }
        } else if (n === 3 && l.stateNode.current.memoizedState.isDehydrated) {
          t.blockedOn = l.tag === 3 ? l.stateNode.containerInfo : null;
          return;
        }
      }
    }
    t.blockedOn = null;
  }
  function xo(t) {
    if (t.blockedOn !== null) return !1;
    for (var n = t.targetContainers; 0 < n.length; ) {
      var l = Jl(t.domEventName, t.eventSystemFlags, n[0], t.nativeEvent);
      if (l === null) {
        l = t.nativeEvent;
        var u = new l.constructor(l.type, l);
        tt = u, l.target.dispatchEvent(u), tt = null;
      } else return n = ji(l), n !== null && Kl(n), t.blockedOn = l, !1;
      n.shift();
    }
    return !0;
  }
  function pc(t, n, l) {
    xo(t) && l.delete(n);
  }
  function Gm() {
    Yl = !1, On !== null && xo(On) && (On = null), Fn !== null && xo(Fn) && (Fn = null), $n !== null && xo($n) && ($n = null), fi.forEach(pc), pi.forEach(pc);
  }
  function mi(t, n) {
    t.blockedOn === n && (t.blockedOn = null, Yl || (Yl = !0, r.unstable_scheduleCallback(r.unstable_NormalPriority, Gm)));
  }
  function gi(t) {
    function n(f) {
      return mi(f, t);
    }
    if (0 < vo.length) {
      mi(vo[0], t);
      for (var l = 1; l < vo.length; l++) {
        var u = vo[l];
        u.blockedOn === t && (u.blockedOn = null);
      }
    }
    for (On !== null && mi(On, t), Fn !== null && mi(Fn, t), $n !== null && mi($n, t), fi.forEach(n), pi.forEach(n), l = 0; l < Bn.length; l++) u = Bn[l], u.blockedOn === t && (u.blockedOn = null);
    for (; 0 < Bn.length && (l = Bn[0], l.blockedOn === null); ) fc(l), l.blockedOn === null && Bn.shift();
  }
  var Ar = ne.ReactCurrentBatchConfig, ko = !0;
  function Qm(t, n, l, u) {
    var f = qe, g = Ar.transition;
    Ar.transition = null;
    try {
      qe = 1, Xl(t, n, l, u);
    } finally {
      qe = f, Ar.transition = g;
    }
  }
  function Km(t, n, l, u) {
    var f = qe, g = Ar.transition;
    Ar.transition = null;
    try {
      qe = 4, Xl(t, n, l, u);
    } finally {
      qe = f, Ar.transition = g;
    }
  }
  function Xl(t, n, l, u) {
    if (ko) {
      var f = Jl(t, n, l, u);
      if (f === null) ma(t, n, u, wo, l), dc(t, u);
      else if (Vm(f, t, n, l, u)) u.stopPropagation();
      else if (dc(t, u), n & 4 && -1 < Wm.indexOf(t)) {
        for (; f !== null; ) {
          var g = ji(f);
          if (g !== null && ac(g), g = Jl(t, n, l, u), g === null && ma(t, n, u, wo, l), g === f) break;
          f = g;
        }
        f !== null && u.stopPropagation();
      } else ma(t, n, u, null, l);
    }
  }
  var wo = null;
  function Jl(t, n, l, u) {
    if (wo = null, t = Rr(u), t = cr(t), t !== null) if (n = ur(t), n === null) t = null;
    else if (l = n.tag, l === 13) {
      if (t = Xu(n), t !== null) return t;
      t = null;
    } else if (l === 3) {
      if (n.stateNode.current.memoizedState.isDehydrated) return n.tag === 3 ? n.stateNode.containerInfo : null;
      t = null;
    } else n !== t && (t = null);
    return wo = t, null;
  }
  function hc(t) {
    switch (t) {
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 1;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "toggle":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 4;
      case "message":
        switch (Dm()) {
          case Wl:
            return 1;
          case rc:
            return 4;
          case po:
          case Mm:
            return 16;
          case ic:
            return 536870912;
          default:
            return 16;
        }
      default:
        return 16;
    }
  }
  var Hn = null, Zl = null, bo = null;
  function mc() {
    if (bo) return bo;
    var t, n = Zl, l = n.length, u, f = "value" in Hn ? Hn.value : Hn.textContent, g = f.length;
    for (t = 0; t < l && n[t] === f[t]; t++) ;
    var k = l - t;
    for (u = 1; u <= k && n[l - u] === f[g - u]; u++) ;
    return bo = f.slice(t, 1 < u ? 1 - u : void 0);
  }
  function So(t) {
    var n = t.keyCode;
    return "charCode" in t ? (t = t.charCode, t === 0 && n === 13 && (t = 13)) : t = n, t === 10 && (t = 13), 32 <= t || t === 13 ? t : 0;
  }
  function Co() {
    return !0;
  }
  function gc() {
    return !1;
  }
  function It(t) {
    function n(l, u, f, g, k) {
      this._reactName = l, this._targetInst = f, this.type = u, this.nativeEvent = g, this.target = k, this.currentTarget = null;
      for (var C in t) t.hasOwnProperty(C) && (l = t[C], this[C] = l ? l(g) : g[C]);
      return this.isDefaultPrevented = (g.defaultPrevented != null ? g.defaultPrevented : g.returnValue === !1) ? Co : gc, this.isPropagationStopped = gc, this;
    }
    return b(n.prototype, { preventDefault: function() {
      this.defaultPrevented = !0;
      var l = this.nativeEvent;
      l && (l.preventDefault ? l.preventDefault() : typeof l.returnValue != "unknown" && (l.returnValue = !1), this.isDefaultPrevented = Co);
    }, stopPropagation: function() {
      var l = this.nativeEvent;
      l && (l.stopPropagation ? l.stopPropagation() : typeof l.cancelBubble != "unknown" && (l.cancelBubble = !0), this.isPropagationStopped = Co);
    }, persist: function() {
    }, isPersistent: Co }), n;
  }
  var zr = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(t) {
    return t.timeStamp || Date.now();
  }, defaultPrevented: 0, isTrusted: 0 }, ea = It(zr), yi = b({}, zr, { view: 0, detail: 0 }), Ym = It(yi), ta, na, vi, Eo = b({}, yi, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: ia, button: 0, buttons: 0, relatedTarget: function(t) {
    return t.relatedTarget === void 0 ? t.fromElement === t.srcElement ? t.toElement : t.fromElement : t.relatedTarget;
  }, movementX: function(t) {
    return "movementX" in t ? t.movementX : (t !== vi && (vi && t.type === "mousemove" ? (ta = t.screenX - vi.screenX, na = t.screenY - vi.screenY) : na = ta = 0, vi = t), ta);
  }, movementY: function(t) {
    return "movementY" in t ? t.movementY : na;
  } }), yc = It(Eo), Xm = b({}, Eo, { dataTransfer: 0 }), Jm = It(Xm), Zm = b({}, yi, { relatedTarget: 0 }), ra = It(Zm), eg = b({}, zr, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }), tg = It(eg), ng = b({}, zr, { clipboardData: function(t) {
    return "clipboardData" in t ? t.clipboardData : window.clipboardData;
  } }), rg = It(ng), ig = b({}, zr, { data: 0 }), vc = It(ig), og = {
    Esc: "Escape",
    Spacebar: " ",
    Left: "ArrowLeft",
    Up: "ArrowUp",
    Right: "ArrowRight",
    Down: "ArrowDown",
    Del: "Delete",
    Win: "OS",
    Menu: "ContextMenu",
    Apps: "ContextMenu",
    Scroll: "ScrollLock",
    MozPrintableKey: "Unidentified"
  }, lg = {
    8: "Backspace",
    9: "Tab",
    12: "Clear",
    13: "Enter",
    16: "Shift",
    17: "Control",
    18: "Alt",
    19: "Pause",
    20: "CapsLock",
    27: "Escape",
    32: " ",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    45: "Insert",
    46: "Delete",
    112: "F1",
    113: "F2",
    114: "F3",
    115: "F4",
    116: "F5",
    117: "F6",
    118: "F7",
    119: "F8",
    120: "F9",
    121: "F10",
    122: "F11",
    123: "F12",
    144: "NumLock",
    145: "ScrollLock",
    224: "Meta"
  }, ag = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
  function sg(t) {
    var n = this.nativeEvent;
    return n.getModifierState ? n.getModifierState(t) : (t = ag[t]) ? !!n[t] : !1;
  }
  function ia() {
    return sg;
  }
  var ug = b({}, yi, { key: function(t) {
    if (t.key) {
      var n = og[t.key] || t.key;
      if (n !== "Unidentified") return n;
    }
    return t.type === "keypress" ? (t = So(t), t === 13 ? "Enter" : String.fromCharCode(t)) : t.type === "keydown" || t.type === "keyup" ? lg[t.keyCode] || "Unidentified" : "";
  }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: ia, charCode: function(t) {
    return t.type === "keypress" ? So(t) : 0;
  }, keyCode: function(t) {
    return t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
  }, which: function(t) {
    return t.type === "keypress" ? So(t) : t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
  } }), cg = It(ug), dg = b({}, Eo, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 }), xc = It(dg), fg = b({}, yi, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: ia }), pg = It(fg), hg = b({}, zr, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }), mg = It(hg), gg = b({}, Eo, {
    deltaX: function(t) {
      return "deltaX" in t ? t.deltaX : "wheelDeltaX" in t ? -t.wheelDeltaX : 0;
    },
    deltaY: function(t) {
      return "deltaY" in t ? t.deltaY : "wheelDeltaY" in t ? -t.wheelDeltaY : "wheelDelta" in t ? -t.wheelDelta : 0;
    },
    deltaZ: 0,
    deltaMode: 0
  }), yg = It(gg), vg = [9, 13, 27, 32], oa = d && "CompositionEvent" in window, xi = null;
  d && "documentMode" in document && (xi = document.documentMode);
  var xg = d && "TextEvent" in window && !xi, kc = d && (!oa || xi && 8 < xi && 11 >= xi), wc = " ", bc = !1;
  function Sc(t, n) {
    switch (t) {
      case "keyup":
        return vg.indexOf(n.keyCode) !== -1;
      case "keydown":
        return n.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function Cc(t) {
    return t = t.detail, typeof t == "object" && "data" in t ? t.data : null;
  }
  var Pr = !1;
  function kg(t, n) {
    switch (t) {
      case "compositionend":
        return Cc(n);
      case "keypress":
        return n.which !== 32 ? null : (bc = !0, wc);
      case "textInput":
        return t = n.data, t === wc && bc ? null : t;
      default:
        return null;
    }
  }
  function wg(t, n) {
    if (Pr) return t === "compositionend" || !oa && Sc(t, n) ? (t = mc(), bo = Zl = Hn = null, Pr = !1, t) : null;
    switch (t) {
      case "paste":
        return null;
      case "keypress":
        if (!(n.ctrlKey || n.altKey || n.metaKey) || n.ctrlKey && n.altKey) {
          if (n.char && 1 < n.char.length) return n.char;
          if (n.which) return String.fromCharCode(n.which);
        }
        return null;
      case "compositionend":
        return kc && n.locale !== "ko" ? null : n.data;
      default:
        return null;
    }
  }
  var bg = { color: !0, date: !0, datetime: !0, "datetime-local": !0, email: !0, month: !0, number: !0, password: !0, range: !0, search: !0, tel: !0, text: !0, time: !0, url: !0, week: !0 };
  function Ec(t) {
    var n = t && t.nodeName && t.nodeName.toLowerCase();
    return n === "input" ? !!bg[t.type] : n === "textarea";
  }
  function _c(t, n, l, u) {
    Vu(u), n = Lo(n, "onChange"), 0 < n.length && (l = new ea("onChange", "change", null, l, u), t.push({ event: l, listeners: n }));
  }
  var ki = null, wi = null;
  function Sg(t) {
    Uc(t, 0);
  }
  function _o(t) {
    var n = Fr(t);
    if (Sn(n)) return t;
  }
  function Cg(t, n) {
    if (t === "change") return n;
  }
  var Tc = !1;
  if (d) {
    var la;
    if (d) {
      var aa = "oninput" in document;
      if (!aa) {
        var jc = document.createElement("div");
        jc.setAttribute("oninput", "return;"), aa = typeof jc.oninput == "function";
      }
      la = aa;
    } else la = !1;
    Tc = la && (!document.documentMode || 9 < document.documentMode);
  }
  function Rc() {
    ki && (ki.detachEvent("onpropertychange", Lc), wi = ki = null);
  }
  function Lc(t) {
    if (t.propertyName === "value" && _o(wi)) {
      var n = [];
      _c(n, wi, t, Rr(t)), Yu(Sg, n);
    }
  }
  function Eg(t, n, l) {
    t === "focusin" ? (Rc(), ki = n, wi = l, ki.attachEvent("onpropertychange", Lc)) : t === "focusout" && Rc();
  }
  function _g(t) {
    if (t === "selectionchange" || t === "keyup" || t === "keydown") return _o(wi);
  }
  function Tg(t, n) {
    if (t === "click") return _o(n);
  }
  function jg(t, n) {
    if (t === "input" || t === "change") return _o(n);
  }
  function Rg(t, n) {
    return t === n && (t !== 0 || 1 / t === 1 / n) || t !== t && n !== n;
  }
  var en = typeof Object.is == "function" ? Object.is : Rg;
  function bi(t, n) {
    if (en(t, n)) return !0;
    if (typeof t != "object" || t === null || typeof n != "object" || n === null) return !1;
    var l = Object.keys(t), u = Object.keys(n);
    if (l.length !== u.length) return !1;
    for (u = 0; u < l.length; u++) {
      var f = l[u];
      if (!p.call(n, f) || !en(t[f], n[f])) return !1;
    }
    return !0;
  }
  function Nc(t) {
    for (; t && t.firstChild; ) t = t.firstChild;
    return t;
  }
  function Ac(t, n) {
    var l = Nc(t);
    t = 0;
    for (var u; l; ) {
      if (l.nodeType === 3) {
        if (u = t + l.textContent.length, t <= n && u >= n) return { node: l, offset: n - t };
        t = u;
      }
      e: {
        for (; l; ) {
          if (l.nextSibling) {
            l = l.nextSibling;
            break e;
          }
          l = l.parentNode;
        }
        l = void 0;
      }
      l = Nc(l);
    }
  }
  function zc(t, n) {
    return t && n ? t === n ? !0 : t && t.nodeType === 3 ? !1 : n && n.nodeType === 3 ? zc(t, n.parentNode) : "contains" in t ? t.contains(n) : t.compareDocumentPosition ? !!(t.compareDocumentPosition(n) & 16) : !1 : !1;
  }
  function Pc() {
    for (var t = window, n = W(); n instanceof t.HTMLIFrameElement; ) {
      try {
        var l = typeof n.contentWindow.location.href == "string";
      } catch {
        l = !1;
      }
      if (l) t = n.contentWindow;
      else break;
      n = W(t.document);
    }
    return n;
  }
  function sa(t) {
    var n = t && t.nodeName && t.nodeName.toLowerCase();
    return n && (n === "input" && (t.type === "text" || t.type === "search" || t.type === "tel" || t.type === "url" || t.type === "password") || n === "textarea" || t.contentEditable === "true");
  }
  function Lg(t) {
    var n = Pc(), l = t.focusedElem, u = t.selectionRange;
    if (n !== l && l && l.ownerDocument && zc(l.ownerDocument.documentElement, l)) {
      if (u !== null && sa(l)) {
        if (n = u.start, t = u.end, t === void 0 && (t = n), "selectionStart" in l) l.selectionStart = n, l.selectionEnd = Math.min(t, l.value.length);
        else if (t = (n = l.ownerDocument || document) && n.defaultView || window, t.getSelection) {
          t = t.getSelection();
          var f = l.textContent.length, g = Math.min(u.start, f);
          u = u.end === void 0 ? g : Math.min(u.end, f), !t.extend && g > u && (f = u, u = g, g = f), f = Ac(l, g);
          var k = Ac(
            l,
            u
          );
          f && k && (t.rangeCount !== 1 || t.anchorNode !== f.node || t.anchorOffset !== f.offset || t.focusNode !== k.node || t.focusOffset !== k.offset) && (n = n.createRange(), n.setStart(f.node, f.offset), t.removeAllRanges(), g > u ? (t.addRange(n), t.extend(k.node, k.offset)) : (n.setEnd(k.node, k.offset), t.addRange(n)));
        }
      }
      for (n = [], t = l; t = t.parentNode; ) t.nodeType === 1 && n.push({ element: t, left: t.scrollLeft, top: t.scrollTop });
      for (typeof l.focus == "function" && l.focus(), l = 0; l < n.length; l++) t = n[l], t.element.scrollLeft = t.left, t.element.scrollTop = t.top;
    }
  }
  var Ng = d && "documentMode" in document && 11 >= document.documentMode, Ir = null, ua = null, Si = null, ca = !1;
  function Ic(t, n, l) {
    var u = l.window === l ? l.document : l.nodeType === 9 ? l : l.ownerDocument;
    ca || Ir == null || Ir !== W(u) || (u = Ir, "selectionStart" in u && sa(u) ? u = { start: u.selectionStart, end: u.selectionEnd } : (u = (u.ownerDocument && u.ownerDocument.defaultView || window).getSelection(), u = { anchorNode: u.anchorNode, anchorOffset: u.anchorOffset, focusNode: u.focusNode, focusOffset: u.focusOffset }), Si && bi(Si, u) || (Si = u, u = Lo(ua, "onSelect"), 0 < u.length && (n = new ea("onSelect", "select", null, n, l), t.push({ event: n, listeners: u }), n.target = Ir)));
  }
  function To(t, n) {
    var l = {};
    return l[t.toLowerCase()] = n.toLowerCase(), l["Webkit" + t] = "webkit" + n, l["Moz" + t] = "moz" + n, l;
  }
  var Dr = { animationend: To("Animation", "AnimationEnd"), animationiteration: To("Animation", "AnimationIteration"), animationstart: To("Animation", "AnimationStart"), transitionend: To("Transition", "TransitionEnd") }, da = {}, Dc = {};
  d && (Dc = document.createElement("div").style, "AnimationEvent" in window || (delete Dr.animationend.animation, delete Dr.animationiteration.animation, delete Dr.animationstart.animation), "TransitionEvent" in window || delete Dr.transitionend.transition);
  function jo(t) {
    if (da[t]) return da[t];
    if (!Dr[t]) return t;
    var n = Dr[t], l;
    for (l in n) if (n.hasOwnProperty(l) && l in Dc) return da[t] = n[l];
    return t;
  }
  var Mc = jo("animationend"), Oc = jo("animationiteration"), Fc = jo("animationstart"), $c = jo("transitionend"), Bc = /* @__PURE__ */ new Map(), Hc = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
  function qn(t, n) {
    Bc.set(t, n), s(n, [t]);
  }
  for (var fa = 0; fa < Hc.length; fa++) {
    var pa = Hc[fa], Ag = pa.toLowerCase(), zg = pa[0].toUpperCase() + pa.slice(1);
    qn(Ag, "on" + zg);
  }
  qn(Mc, "onAnimationEnd"), qn(Oc, "onAnimationIteration"), qn(Fc, "onAnimationStart"), qn("dblclick", "onDoubleClick"), qn("focusin", "onFocus"), qn("focusout", "onBlur"), qn($c, "onTransitionEnd"), c("onMouseEnter", ["mouseout", "mouseover"]), c("onMouseLeave", ["mouseout", "mouseover"]), c("onPointerEnter", ["pointerout", "pointerover"]), c("onPointerLeave", ["pointerout", "pointerover"]), s("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), s("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), s("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]), s("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), s("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), s("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
  var Ci = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), Pg = new Set("cancel close invalid load scroll toggle".split(" ").concat(Ci));
  function qc(t, n, l) {
    var u = t.type || "unknown-event";
    t.currentTarget = l, Am(u, n, void 0, t), t.currentTarget = null;
  }
  function Uc(t, n) {
    n = (n & 4) !== 0;
    for (var l = 0; l < t.length; l++) {
      var u = t[l], f = u.event;
      u = u.listeners;
      e: {
        var g = void 0;
        if (n) for (var k = u.length - 1; 0 <= k; k--) {
          var C = u[k], T = C.instance, M = C.currentTarget;
          if (C = C.listener, T !== g && f.isPropagationStopped()) break e;
          qc(f, C, M), g = T;
        }
        else for (k = 0; k < u.length; k++) {
          if (C = u[k], T = C.instance, M = C.currentTarget, C = C.listener, T !== g && f.isPropagationStopped()) break e;
          qc(f, C, M), g = T;
        }
      }
    }
    if (fo) throw t = Ul, fo = !1, Ul = null, t;
  }
  function Ye(t, n) {
    var l = n[wa];
    l === void 0 && (l = n[wa] = /* @__PURE__ */ new Set());
    var u = t + "__bubble";
    l.has(u) || (Wc(n, t, 2, !1), l.add(u));
  }
  function ha(t, n, l) {
    var u = 0;
    n && (u |= 4), Wc(l, t, u, n);
  }
  var Ro = "_reactListening" + Math.random().toString(36).slice(2);
  function Ei(t) {
    if (!t[Ro]) {
      t[Ro] = !0, o.forEach(function(l) {
        l !== "selectionchange" && (Pg.has(l) || ha(l, !1, t), ha(l, !0, t));
      });
      var n = t.nodeType === 9 ? t : t.ownerDocument;
      n === null || n[Ro] || (n[Ro] = !0, ha("selectionchange", !1, n));
    }
  }
  function Wc(t, n, l, u) {
    switch (hc(n)) {
      case 1:
        var f = Qm;
        break;
      case 4:
        f = Km;
        break;
      default:
        f = Xl;
    }
    l = f.bind(null, n, l, t), f = void 0, !ql || n !== "touchstart" && n !== "touchmove" && n !== "wheel" || (f = !0), u ? f !== void 0 ? t.addEventListener(n, l, { capture: !0, passive: f }) : t.addEventListener(n, l, !0) : f !== void 0 ? t.addEventListener(n, l, { passive: f }) : t.addEventListener(n, l, !1);
  }
  function ma(t, n, l, u, f) {
    var g = u;
    if ((n & 1) === 0 && (n & 2) === 0 && u !== null) e: for (; ; ) {
      if (u === null) return;
      var k = u.tag;
      if (k === 3 || k === 4) {
        var C = u.stateNode.containerInfo;
        if (C === f || C.nodeType === 8 && C.parentNode === f) break;
        if (k === 4) for (k = u.return; k !== null; ) {
          var T = k.tag;
          if ((T === 3 || T === 4) && (T = k.stateNode.containerInfo, T === f || T.nodeType === 8 && T.parentNode === f)) return;
          k = k.return;
        }
        for (; C !== null; ) {
          if (k = cr(C), k === null) return;
          if (T = k.tag, T === 5 || T === 6) {
            u = g = k;
            continue e;
          }
          C = C.parentNode;
        }
      }
      u = u.return;
    }
    Yu(function() {
      var M = g, G = Rr(l), Q = [];
      e: {
        var V = Bc.get(t);
        if (V !== void 0) {
          var ae = ea, de = t;
          switch (t) {
            case "keypress":
              if (So(l) === 0) break e;
            case "keydown":
            case "keyup":
              ae = cg;
              break;
            case "focusin":
              de = "focus", ae = ra;
              break;
            case "focusout":
              de = "blur", ae = ra;
              break;
            case "beforeblur":
            case "afterblur":
              ae = ra;
              break;
            case "click":
              if (l.button === 2) break e;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              ae = yc;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              ae = Jm;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              ae = pg;
              break;
            case Mc:
            case Oc:
            case Fc:
              ae = tg;
              break;
            case $c:
              ae = mg;
              break;
            case "scroll":
              ae = Ym;
              break;
            case "wheel":
              ae = yg;
              break;
            case "copy":
            case "cut":
            case "paste":
              ae = rg;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              ae = xc;
          }
          var pe = (n & 4) !== 0, lt = !pe && t === "scroll", A = pe ? V !== null ? V + "Capture" : null : V;
          pe = [];
          for (var R = M, P; R !== null; ) {
            P = R;
            var J = P.stateNode;
            if (P.tag === 5 && J !== null && (P = J, A !== null && (J = ai(R, A), J != null && pe.push(_i(R, J, P)))), lt) break;
            R = R.return;
          }
          0 < pe.length && (V = new ae(V, de, null, l, G), Q.push({ event: V, listeners: pe }));
        }
      }
      if ((n & 7) === 0) {
        e: {
          if (V = t === "mouseover" || t === "pointerover", ae = t === "mouseout" || t === "pointerout", V && l !== tt && (de = l.relatedTarget || l.fromElement) && (cr(de) || de[En])) break e;
          if ((ae || V) && (V = G.window === G ? G : (V = G.ownerDocument) ? V.defaultView || V.parentWindow : window, ae ? (de = l.relatedTarget || l.toElement, ae = M, de = de ? cr(de) : null, de !== null && (lt = ur(de), de !== lt || de.tag !== 5 && de.tag !== 6) && (de = null)) : (ae = null, de = M), ae !== de)) {
            if (pe = yc, J = "onMouseLeave", A = "onMouseEnter", R = "mouse", (t === "pointerout" || t === "pointerover") && (pe = xc, J = "onPointerLeave", A = "onPointerEnter", R = "pointer"), lt = ae == null ? V : Fr(ae), P = de == null ? V : Fr(de), V = new pe(J, R + "leave", ae, l, G), V.target = lt, V.relatedTarget = P, J = null, cr(G) === M && (pe = new pe(A, R + "enter", de, l, G), pe.target = P, pe.relatedTarget = lt, J = pe), lt = J, ae && de) t: {
              for (pe = ae, A = de, R = 0, P = pe; P; P = Mr(P)) R++;
              for (P = 0, J = A; J; J = Mr(J)) P++;
              for (; 0 < R - P; ) pe = Mr(pe), R--;
              for (; 0 < P - R; ) A = Mr(A), P--;
              for (; R--; ) {
                if (pe === A || A !== null && pe === A.alternate) break t;
                pe = Mr(pe), A = Mr(A);
              }
              pe = null;
            }
            else pe = null;
            ae !== null && Vc(Q, V, ae, pe, !1), de !== null && lt !== null && Vc(Q, lt, de, pe, !0);
          }
        }
        e: {
          if (V = M ? Fr(M) : window, ae = V.nodeName && V.nodeName.toLowerCase(), ae === "select" || ae === "input" && V.type === "file") var me = Cg;
          else if (Ec(V)) if (Tc) me = jg;
          else {
            me = _g;
            var we = Eg;
          }
          else (ae = V.nodeName) && ae.toLowerCase() === "input" && (V.type === "checkbox" || V.type === "radio") && (me = Tg);
          if (me && (me = me(t, M))) {
            _c(Q, me, l, G);
            break e;
          }
          we && we(t, V, M), t === "focusout" && (we = V._wrapperState) && we.controlled && V.type === "number" && dt(V, "number", V.value);
        }
        switch (we = M ? Fr(M) : window, t) {
          case "focusin":
            (Ec(we) || we.contentEditable === "true") && (Ir = we, ua = M, Si = null);
            break;
          case "focusout":
            Si = ua = Ir = null;
            break;
          case "mousedown":
            ca = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            ca = !1, Ic(Q, l, G);
            break;
          case "selectionchange":
            if (Ng) break;
          case "keydown":
          case "keyup":
            Ic(Q, l, G);
        }
        var be;
        if (oa) e: {
          switch (t) {
            case "compositionstart":
              var Te = "onCompositionStart";
              break e;
            case "compositionend":
              Te = "onCompositionEnd";
              break e;
            case "compositionupdate":
              Te = "onCompositionUpdate";
              break e;
          }
          Te = void 0;
        }
        else Pr ? Sc(t, l) && (Te = "onCompositionEnd") : t === "keydown" && l.keyCode === 229 && (Te = "onCompositionStart");
        Te && (kc && l.locale !== "ko" && (Pr || Te !== "onCompositionStart" ? Te === "onCompositionEnd" && Pr && (be = mc()) : (Hn = G, Zl = "value" in Hn ? Hn.value : Hn.textContent, Pr = !0)), we = Lo(M, Te), 0 < we.length && (Te = new vc(Te, t, null, l, G), Q.push({ event: Te, listeners: we }), be ? Te.data = be : (be = Cc(l), be !== null && (Te.data = be)))), (be = xg ? kg(t, l) : wg(t, l)) && (M = Lo(M, "onBeforeInput"), 0 < M.length && (G = new vc("onBeforeInput", "beforeinput", null, l, G), Q.push({ event: G, listeners: M }), G.data = be));
      }
      Uc(Q, n);
    });
  }
  function _i(t, n, l) {
    return { instance: t, listener: n, currentTarget: l };
  }
  function Lo(t, n) {
    for (var l = n + "Capture", u = []; t !== null; ) {
      var f = t, g = f.stateNode;
      f.tag === 5 && g !== null && (f = g, g = ai(t, l), g != null && u.unshift(_i(t, g, f)), g = ai(t, n), g != null && u.push(_i(t, g, f))), t = t.return;
    }
    return u;
  }
  function Mr(t) {
    if (t === null) return null;
    do
      t = t.return;
    while (t && t.tag !== 5);
    return t || null;
  }
  function Vc(t, n, l, u, f) {
    for (var g = n._reactName, k = []; l !== null && l !== u; ) {
      var C = l, T = C.alternate, M = C.stateNode;
      if (T !== null && T === u) break;
      C.tag === 5 && M !== null && (C = M, f ? (T = ai(l, g), T != null && k.unshift(_i(l, T, C))) : f || (T = ai(l, g), T != null && k.push(_i(l, T, C)))), l = l.return;
    }
    k.length !== 0 && t.push({ event: n, listeners: k });
  }
  var Ig = /\r\n?/g, Dg = /\u0000|\uFFFD/g;
  function Gc(t) {
    return (typeof t == "string" ? t : "" + t).replace(Ig, `
`).replace(Dg, "");
  }
  function No(t, n, l) {
    if (n = Gc(n), Gc(t) !== n && l) throw Error(i(425));
  }
  function Ao() {
  }
  var ga = null, ya = null;
  function va(t, n) {
    return t === "textarea" || t === "noscript" || typeof n.children == "string" || typeof n.children == "number" || typeof n.dangerouslySetInnerHTML == "object" && n.dangerouslySetInnerHTML !== null && n.dangerouslySetInnerHTML.__html != null;
  }
  var xa = typeof setTimeout == "function" ? setTimeout : void 0, Mg = typeof clearTimeout == "function" ? clearTimeout : void 0, Qc = typeof Promise == "function" ? Promise : void 0, Og = typeof queueMicrotask == "function" ? queueMicrotask : typeof Qc < "u" ? function(t) {
    return Qc.resolve(null).then(t).catch(Fg);
  } : xa;
  function Fg(t) {
    setTimeout(function() {
      throw t;
    });
  }
  function ka(t, n) {
    var l = n, u = 0;
    do {
      var f = l.nextSibling;
      if (t.removeChild(l), f && f.nodeType === 8) if (l = f.data, l === "/$") {
        if (u === 0) {
          t.removeChild(f), gi(n);
          return;
        }
        u--;
      } else l !== "$" && l !== "$?" && l !== "$!" || u++;
      l = f;
    } while (l);
    gi(n);
  }
  function Un(t) {
    for (; t != null; t = t.nextSibling) {
      var n = t.nodeType;
      if (n === 1 || n === 3) break;
      if (n === 8) {
        if (n = t.data, n === "$" || n === "$!" || n === "$?") break;
        if (n === "/$") return null;
      }
    }
    return t;
  }
  function Kc(t) {
    t = t.previousSibling;
    for (var n = 0; t; ) {
      if (t.nodeType === 8) {
        var l = t.data;
        if (l === "$" || l === "$!" || l === "$?") {
          if (n === 0) return t;
          n--;
        } else l === "/$" && n++;
      }
      t = t.previousSibling;
    }
    return null;
  }
  var Or = Math.random().toString(36).slice(2), hn = "__reactFiber$" + Or, Ti = "__reactProps$" + Or, En = "__reactContainer$" + Or, wa = "__reactEvents$" + Or, $g = "__reactListeners$" + Or, Bg = "__reactHandles$" + Or;
  function cr(t) {
    var n = t[hn];
    if (n) return n;
    for (var l = t.parentNode; l; ) {
      if (n = l[En] || l[hn]) {
        if (l = n.alternate, n.child !== null || l !== null && l.child !== null) for (t = Kc(t); t !== null; ) {
          if (l = t[hn]) return l;
          t = Kc(t);
        }
        return n;
      }
      t = l, l = t.parentNode;
    }
    return null;
  }
  function ji(t) {
    return t = t[hn] || t[En], !t || t.tag !== 5 && t.tag !== 6 && t.tag !== 13 && t.tag !== 3 ? null : t;
  }
  function Fr(t) {
    if (t.tag === 5 || t.tag === 6) return t.stateNode;
    throw Error(i(33));
  }
  function zo(t) {
    return t[Ti] || null;
  }
  var ba = [], $r = -1;
  function Wn(t) {
    return { current: t };
  }
  function Xe(t) {
    0 > $r || (t.current = ba[$r], ba[$r] = null, $r--);
  }
  function Qe(t, n) {
    $r++, ba[$r] = t.current, t.current = n;
  }
  var Vn = {}, yt = Wn(Vn), Tt = Wn(!1), dr = Vn;
  function Br(t, n) {
    var l = t.type.contextTypes;
    if (!l) return Vn;
    var u = t.stateNode;
    if (u && u.__reactInternalMemoizedUnmaskedChildContext === n) return u.__reactInternalMemoizedMaskedChildContext;
    var f = {}, g;
    for (g in l) f[g] = n[g];
    return u && (t = t.stateNode, t.__reactInternalMemoizedUnmaskedChildContext = n, t.__reactInternalMemoizedMaskedChildContext = f), f;
  }
  function jt(t) {
    return t = t.childContextTypes, t != null;
  }
  function Po() {
    Xe(Tt), Xe(yt);
  }
  function Yc(t, n, l) {
    if (yt.current !== Vn) throw Error(i(168));
    Qe(yt, n), Qe(Tt, l);
  }
  function Xc(t, n, l) {
    var u = t.stateNode;
    if (n = n.childContextTypes, typeof u.getChildContext != "function") return l;
    u = u.getChildContext();
    for (var f in u) if (!(f in n)) throw Error(i(108, Re(t) || "Unknown", f));
    return b({}, l, u);
  }
  function Io(t) {
    return t = (t = t.stateNode) && t.__reactInternalMemoizedMergedChildContext || Vn, dr = yt.current, Qe(yt, t), Qe(Tt, Tt.current), !0;
  }
  function Jc(t, n, l) {
    var u = t.stateNode;
    if (!u) throw Error(i(169));
    l ? (t = Xc(t, n, dr), u.__reactInternalMemoizedMergedChildContext = t, Xe(Tt), Xe(yt), Qe(yt, t)) : Xe(Tt), Qe(Tt, l);
  }
  var _n = null, Do = !1, Sa = !1;
  function Zc(t) {
    _n === null ? _n = [t] : _n.push(t);
  }
  function Hg(t) {
    Do = !0, Zc(t);
  }
  function Gn() {
    if (!Sa && _n !== null) {
      Sa = !0;
      var t = 0, n = qe;
      try {
        var l = _n;
        for (qe = 1; t < l.length; t++) {
          var u = l[t];
          do
            u = u(!0);
          while (u !== null);
        }
        _n = null, Do = !1;
      } catch (f) {
        throw _n !== null && (_n = _n.slice(t + 1)), tc(Wl, Gn), f;
      } finally {
        qe = n, Sa = !1;
      }
    }
    return null;
  }
  var Hr = [], qr = 0, Mo = null, Oo = 0, Ht = [], qt = 0, fr = null, Tn = 1, jn = "";
  function pr(t, n) {
    Hr[qr++] = Oo, Hr[qr++] = Mo, Mo = t, Oo = n;
  }
  function ed(t, n, l) {
    Ht[qt++] = Tn, Ht[qt++] = jn, Ht[qt++] = fr, fr = t;
    var u = Tn;
    t = jn;
    var f = 32 - Zt(u) - 1;
    u &= ~(1 << f), l += 1;
    var g = 32 - Zt(n) + f;
    if (30 < g) {
      var k = f - f % 5;
      g = (u & (1 << k) - 1).toString(32), u >>= k, f -= k, Tn = 1 << 32 - Zt(n) + f | l << f | u, jn = g + t;
    } else Tn = 1 << g | l << f | u, jn = t;
  }
  function Ca(t) {
    t.return !== null && (pr(t, 1), ed(t, 1, 0));
  }
  function Ea(t) {
    for (; t === Mo; ) Mo = Hr[--qr], Hr[qr] = null, Oo = Hr[--qr], Hr[qr] = null;
    for (; t === fr; ) fr = Ht[--qt], Ht[qt] = null, jn = Ht[--qt], Ht[qt] = null, Tn = Ht[--qt], Ht[qt] = null;
  }
  var Dt = null, Mt = null, Je = !1, tn = null;
  function td(t, n) {
    var l = Gt(5, null, null, 0);
    l.elementType = "DELETED", l.stateNode = n, l.return = t, n = t.deletions, n === null ? (t.deletions = [l], t.flags |= 16) : n.push(l);
  }
  function nd(t, n) {
    switch (t.tag) {
      case 5:
        var l = t.type;
        return n = n.nodeType !== 1 || l.toLowerCase() !== n.nodeName.toLowerCase() ? null : n, n !== null ? (t.stateNode = n, Dt = t, Mt = Un(n.firstChild), !0) : !1;
      case 6:
        return n = t.pendingProps === "" || n.nodeType !== 3 ? null : n, n !== null ? (t.stateNode = n, Dt = t, Mt = null, !0) : !1;
      case 13:
        return n = n.nodeType !== 8 ? null : n, n !== null ? (l = fr !== null ? { id: Tn, overflow: jn } : null, t.memoizedState = { dehydrated: n, treeContext: l, retryLane: 1073741824 }, l = Gt(18, null, null, 0), l.stateNode = n, l.return = t, t.child = l, Dt = t, Mt = null, !0) : !1;
      default:
        return !1;
    }
  }
  function _a(t) {
    return (t.mode & 1) !== 0 && (t.flags & 128) === 0;
  }
  function Ta(t) {
    if (Je) {
      var n = Mt;
      if (n) {
        var l = n;
        if (!nd(t, n)) {
          if (_a(t)) throw Error(i(418));
          n = Un(l.nextSibling);
          var u = Dt;
          n && nd(t, n) ? td(u, l) : (t.flags = t.flags & -4097 | 2, Je = !1, Dt = t);
        }
      } else {
        if (_a(t)) throw Error(i(418));
        t.flags = t.flags & -4097 | 2, Je = !1, Dt = t;
      }
    }
  }
  function rd(t) {
    for (t = t.return; t !== null && t.tag !== 5 && t.tag !== 3 && t.tag !== 13; ) t = t.return;
    Dt = t;
  }
  function Fo(t) {
    if (t !== Dt) return !1;
    if (!Je) return rd(t), Je = !0, !1;
    var n;
    if ((n = t.tag !== 3) && !(n = t.tag !== 5) && (n = t.type, n = n !== "head" && n !== "body" && !va(t.type, t.memoizedProps)), n && (n = Mt)) {
      if (_a(t)) throw id(), Error(i(418));
      for (; n; ) td(t, n), n = Un(n.nextSibling);
    }
    if (rd(t), t.tag === 13) {
      if (t = t.memoizedState, t = t !== null ? t.dehydrated : null, !t) throw Error(i(317));
      e: {
        for (t = t.nextSibling, n = 0; t; ) {
          if (t.nodeType === 8) {
            var l = t.data;
            if (l === "/$") {
              if (n === 0) {
                Mt = Un(t.nextSibling);
                break e;
              }
              n--;
            } else l !== "$" && l !== "$!" && l !== "$?" || n++;
          }
          t = t.nextSibling;
        }
        Mt = null;
      }
    } else Mt = Dt ? Un(t.stateNode.nextSibling) : null;
    return !0;
  }
  function id() {
    for (var t = Mt; t; ) t = Un(t.nextSibling);
  }
  function Ur() {
    Mt = Dt = null, Je = !1;
  }
  function ja(t) {
    tn === null ? tn = [t] : tn.push(t);
  }
  var qg = ne.ReactCurrentBatchConfig;
  function Ri(t, n, l) {
    if (t = l.ref, t !== null && typeof t != "function" && typeof t != "object") {
      if (l._owner) {
        if (l = l._owner, l) {
          if (l.tag !== 1) throw Error(i(309));
          var u = l.stateNode;
        }
        if (!u) throw Error(i(147, t));
        var f = u, g = "" + t;
        return n !== null && n.ref !== null && typeof n.ref == "function" && n.ref._stringRef === g ? n.ref : (n = function(k) {
          var C = f.refs;
          k === null ? delete C[g] : C[g] = k;
        }, n._stringRef = g, n);
      }
      if (typeof t != "string") throw Error(i(284));
      if (!l._owner) throw Error(i(290, t));
    }
    return t;
  }
  function $o(t, n) {
    throw t = Object.prototype.toString.call(n), Error(i(31, t === "[object Object]" ? "object with keys {" + Object.keys(n).join(", ") + "}" : t));
  }
  function od(t) {
    var n = t._init;
    return n(t._payload);
  }
  function ld(t) {
    function n(A, R) {
      if (t) {
        var P = A.deletions;
        P === null ? (A.deletions = [R], A.flags |= 16) : P.push(R);
      }
    }
    function l(A, R) {
      if (!t) return null;
      for (; R !== null; ) n(A, R), R = R.sibling;
      return null;
    }
    function u(A, R) {
      for (A = /* @__PURE__ */ new Map(); R !== null; ) R.key !== null ? A.set(R.key, R) : A.set(R.index, R), R = R.sibling;
      return A;
    }
    function f(A, R) {
      return A = tr(A, R), A.index = 0, A.sibling = null, A;
    }
    function g(A, R, P) {
      return A.index = P, t ? (P = A.alternate, P !== null ? (P = P.index, P < R ? (A.flags |= 2, R) : P) : (A.flags |= 2, R)) : (A.flags |= 1048576, R);
    }
    function k(A) {
      return t && A.alternate === null && (A.flags |= 2), A;
    }
    function C(A, R, P, J) {
      return R === null || R.tag !== 6 ? (R = xs(P, A.mode, J), R.return = A, R) : (R = f(R, P), R.return = A, R);
    }
    function T(A, R, P, J) {
      var me = P.type;
      return me === Y ? G(A, R, P.props.children, J, P.key) : R !== null && (R.elementType === me || typeof me == "object" && me !== null && me.$$typeof === ge && od(me) === R.type) ? (J = f(R, P.props), J.ref = Ri(A, R, P), J.return = A, J) : (J = cl(P.type, P.key, P.props, null, A.mode, J), J.ref = Ri(A, R, P), J.return = A, J);
    }
    function M(A, R, P, J) {
      return R === null || R.tag !== 4 || R.stateNode.containerInfo !== P.containerInfo || R.stateNode.implementation !== P.implementation ? (R = ks(P, A.mode, J), R.return = A, R) : (R = f(R, P.children || []), R.return = A, R);
    }
    function G(A, R, P, J, me) {
      return R === null || R.tag !== 7 ? (R = wr(P, A.mode, J, me), R.return = A, R) : (R = f(R, P), R.return = A, R);
    }
    function Q(A, R, P) {
      if (typeof R == "string" && R !== "" || typeof R == "number") return R = xs("" + R, A.mode, P), R.return = A, R;
      if (typeof R == "object" && R !== null) {
        switch (R.$$typeof) {
          case Z:
            return P = cl(R.type, R.key, R.props, null, A.mode, P), P.ref = Ri(A, null, R), P.return = A, P;
          case j:
            return R = ks(R, A.mode, P), R.return = A, R;
          case ge:
            var J = R._init;
            return Q(A, J(R._payload), P);
        }
        if (sn(R) || N(R)) return R = wr(R, A.mode, P, null), R.return = A, R;
        $o(A, R);
      }
      return null;
    }
    function V(A, R, P, J) {
      var me = R !== null ? R.key : null;
      if (typeof P == "string" && P !== "" || typeof P == "number") return me !== null ? null : C(A, R, "" + P, J);
      if (typeof P == "object" && P !== null) {
        switch (P.$$typeof) {
          case Z:
            return P.key === me ? T(A, R, P, J) : null;
          case j:
            return P.key === me ? M(A, R, P, J) : null;
          case ge:
            return me = P._init, V(
              A,
              R,
              me(P._payload),
              J
            );
        }
        if (sn(P) || N(P)) return me !== null ? null : G(A, R, P, J, null);
        $o(A, P);
      }
      return null;
    }
    function ae(A, R, P, J, me) {
      if (typeof J == "string" && J !== "" || typeof J == "number") return A = A.get(P) || null, C(R, A, "" + J, me);
      if (typeof J == "object" && J !== null) {
        switch (J.$$typeof) {
          case Z:
            return A = A.get(J.key === null ? P : J.key) || null, T(R, A, J, me);
          case j:
            return A = A.get(J.key === null ? P : J.key) || null, M(R, A, J, me);
          case ge:
            var we = J._init;
            return ae(A, R, P, we(J._payload), me);
        }
        if (sn(J) || N(J)) return A = A.get(P) || null, G(R, A, J, me, null);
        $o(R, J);
      }
      return null;
    }
    function de(A, R, P, J) {
      for (var me = null, we = null, be = R, Te = R = 0, ht = null; be !== null && Te < P.length; Te++) {
        be.index > Te ? (ht = be, be = null) : ht = be.sibling;
        var $e = V(A, be, P[Te], J);
        if ($e === null) {
          be === null && (be = ht);
          break;
        }
        t && be && $e.alternate === null && n(A, be), R = g($e, R, Te), we === null ? me = $e : we.sibling = $e, we = $e, be = ht;
      }
      if (Te === P.length) return l(A, be), Je && pr(A, Te), me;
      if (be === null) {
        for (; Te < P.length; Te++) be = Q(A, P[Te], J), be !== null && (R = g(be, R, Te), we === null ? me = be : we.sibling = be, we = be);
        return Je && pr(A, Te), me;
      }
      for (be = u(A, be); Te < P.length; Te++) ht = ae(be, A, Te, P[Te], J), ht !== null && (t && ht.alternate !== null && be.delete(ht.key === null ? Te : ht.key), R = g(ht, R, Te), we === null ? me = ht : we.sibling = ht, we = ht);
      return t && be.forEach(function(nr) {
        return n(A, nr);
      }), Je && pr(A, Te), me;
    }
    function pe(A, R, P, J) {
      var me = N(P);
      if (typeof me != "function") throw Error(i(150));
      if (P = me.call(P), P == null) throw Error(i(151));
      for (var we = me = null, be = R, Te = R = 0, ht = null, $e = P.next(); be !== null && !$e.done; Te++, $e = P.next()) {
        be.index > Te ? (ht = be, be = null) : ht = be.sibling;
        var nr = V(A, be, $e.value, J);
        if (nr === null) {
          be === null && (be = ht);
          break;
        }
        t && be && nr.alternate === null && n(A, be), R = g(nr, R, Te), we === null ? me = nr : we.sibling = nr, we = nr, be = ht;
      }
      if ($e.done) return l(
        A,
        be
      ), Je && pr(A, Te), me;
      if (be === null) {
        for (; !$e.done; Te++, $e = P.next()) $e = Q(A, $e.value, J), $e !== null && (R = g($e, R, Te), we === null ? me = $e : we.sibling = $e, we = $e);
        return Je && pr(A, Te), me;
      }
      for (be = u(A, be); !$e.done; Te++, $e = P.next()) $e = ae(be, A, Te, $e.value, J), $e !== null && (t && $e.alternate !== null && be.delete($e.key === null ? Te : $e.key), R = g($e, R, Te), we === null ? me = $e : we.sibling = $e, we = $e);
      return t && be.forEach(function(by) {
        return n(A, by);
      }), Je && pr(A, Te), me;
    }
    function lt(A, R, P, J) {
      if (typeof P == "object" && P !== null && P.type === Y && P.key === null && (P = P.props.children), typeof P == "object" && P !== null) {
        switch (P.$$typeof) {
          case Z:
            e: {
              for (var me = P.key, we = R; we !== null; ) {
                if (we.key === me) {
                  if (me = P.type, me === Y) {
                    if (we.tag === 7) {
                      l(A, we.sibling), R = f(we, P.props.children), R.return = A, A = R;
                      break e;
                    }
                  } else if (we.elementType === me || typeof me == "object" && me !== null && me.$$typeof === ge && od(me) === we.type) {
                    l(A, we.sibling), R = f(we, P.props), R.ref = Ri(A, we, P), R.return = A, A = R;
                    break e;
                  }
                  l(A, we);
                  break;
                } else n(A, we);
                we = we.sibling;
              }
              P.type === Y ? (R = wr(P.props.children, A.mode, J, P.key), R.return = A, A = R) : (J = cl(P.type, P.key, P.props, null, A.mode, J), J.ref = Ri(A, R, P), J.return = A, A = J);
            }
            return k(A);
          case j:
            e: {
              for (we = P.key; R !== null; ) {
                if (R.key === we) if (R.tag === 4 && R.stateNode.containerInfo === P.containerInfo && R.stateNode.implementation === P.implementation) {
                  l(A, R.sibling), R = f(R, P.children || []), R.return = A, A = R;
                  break e;
                } else {
                  l(A, R);
                  break;
                }
                else n(A, R);
                R = R.sibling;
              }
              R = ks(P, A.mode, J), R.return = A, A = R;
            }
            return k(A);
          case ge:
            return we = P._init, lt(A, R, we(P._payload), J);
        }
        if (sn(P)) return de(A, R, P, J);
        if (N(P)) return pe(A, R, P, J);
        $o(A, P);
      }
      return typeof P == "string" && P !== "" || typeof P == "number" ? (P = "" + P, R !== null && R.tag === 6 ? (l(A, R.sibling), R = f(R, P), R.return = A, A = R) : (l(A, R), R = xs(P, A.mode, J), R.return = A, A = R), k(A)) : l(A, R);
    }
    return lt;
  }
  var Wr = ld(!0), ad = ld(!1), Bo = Wn(null), Ho = null, Vr = null, Ra = null;
  function La() {
    Ra = Vr = Ho = null;
  }
  function Na(t) {
    var n = Bo.current;
    Xe(Bo), t._currentValue = n;
  }
  function Aa(t, n, l) {
    for (; t !== null; ) {
      var u = t.alternate;
      if ((t.childLanes & n) !== n ? (t.childLanes |= n, u !== null && (u.childLanes |= n)) : u !== null && (u.childLanes & n) !== n && (u.childLanes |= n), t === l) break;
      t = t.return;
    }
  }
  function Gr(t, n) {
    Ho = t, Ra = Vr = null, t = t.dependencies, t !== null && t.firstContext !== null && ((t.lanes & n) !== 0 && (Rt = !0), t.firstContext = null);
  }
  function Ut(t) {
    var n = t._currentValue;
    if (Ra !== t) if (t = { context: t, memoizedValue: n, next: null }, Vr === null) {
      if (Ho === null) throw Error(i(308));
      Vr = t, Ho.dependencies = { lanes: 0, firstContext: t };
    } else Vr = Vr.next = t;
    return n;
  }
  var hr = null;
  function za(t) {
    hr === null ? hr = [t] : hr.push(t);
  }
  function sd(t, n, l, u) {
    var f = n.interleaved;
    return f === null ? (l.next = l, za(n)) : (l.next = f.next, f.next = l), n.interleaved = l, Rn(t, u);
  }
  function Rn(t, n) {
    t.lanes |= n;
    var l = t.alternate;
    for (l !== null && (l.lanes |= n), l = t, t = t.return; t !== null; ) t.childLanes |= n, l = t.alternate, l !== null && (l.childLanes |= n), l = t, t = t.return;
    return l.tag === 3 ? l.stateNode : null;
  }
  var Qn = !1;
  function Pa(t) {
    t.updateQueue = { baseState: t.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
  }
  function ud(t, n) {
    t = t.updateQueue, n.updateQueue === t && (n.updateQueue = { baseState: t.baseState, firstBaseUpdate: t.firstBaseUpdate, lastBaseUpdate: t.lastBaseUpdate, shared: t.shared, effects: t.effects });
  }
  function Ln(t, n) {
    return { eventTime: t, lane: n, tag: 0, payload: null, callback: null, next: null };
  }
  function Kn(t, n, l) {
    var u = t.updateQueue;
    if (u === null) return null;
    if (u = u.shared, (Fe & 2) !== 0) {
      var f = u.pending;
      return f === null ? n.next = n : (n.next = f.next, f.next = n), u.pending = n, Rn(t, l);
    }
    return f = u.interleaved, f === null ? (n.next = n, za(u)) : (n.next = f.next, f.next = n), u.interleaved = n, Rn(t, l);
  }
  function qo(t, n, l) {
    if (n = n.updateQueue, n !== null && (n = n.shared, (l & 4194240) !== 0)) {
      var u = n.lanes;
      u &= t.pendingLanes, l |= u, n.lanes = l, Ql(t, l);
    }
  }
  function cd(t, n) {
    var l = t.updateQueue, u = t.alternate;
    if (u !== null && (u = u.updateQueue, l === u)) {
      var f = null, g = null;
      if (l = l.firstBaseUpdate, l !== null) {
        do {
          var k = { eventTime: l.eventTime, lane: l.lane, tag: l.tag, payload: l.payload, callback: l.callback, next: null };
          g === null ? f = g = k : g = g.next = k, l = l.next;
        } while (l !== null);
        g === null ? f = g = n : g = g.next = n;
      } else f = g = n;
      l = { baseState: u.baseState, firstBaseUpdate: f, lastBaseUpdate: g, shared: u.shared, effects: u.effects }, t.updateQueue = l;
      return;
    }
    t = l.lastBaseUpdate, t === null ? l.firstBaseUpdate = n : t.next = n, l.lastBaseUpdate = n;
  }
  function Uo(t, n, l, u) {
    var f = t.updateQueue;
    Qn = !1;
    var g = f.firstBaseUpdate, k = f.lastBaseUpdate, C = f.shared.pending;
    if (C !== null) {
      f.shared.pending = null;
      var T = C, M = T.next;
      T.next = null, k === null ? g = M : k.next = M, k = T;
      var G = t.alternate;
      G !== null && (G = G.updateQueue, C = G.lastBaseUpdate, C !== k && (C === null ? G.firstBaseUpdate = M : C.next = M, G.lastBaseUpdate = T));
    }
    if (g !== null) {
      var Q = f.baseState;
      k = 0, G = M = T = null, C = g;
      do {
        var V = C.lane, ae = C.eventTime;
        if ((u & V) === V) {
          G !== null && (G = G.next = {
            eventTime: ae,
            lane: 0,
            tag: C.tag,
            payload: C.payload,
            callback: C.callback,
            next: null
          });
          e: {
            var de = t, pe = C;
            switch (V = n, ae = l, pe.tag) {
              case 1:
                if (de = pe.payload, typeof de == "function") {
                  Q = de.call(ae, Q, V);
                  break e;
                }
                Q = de;
                break e;
              case 3:
                de.flags = de.flags & -65537 | 128;
              case 0:
                if (de = pe.payload, V = typeof de == "function" ? de.call(ae, Q, V) : de, V == null) break e;
                Q = b({}, Q, V);
                break e;
              case 2:
                Qn = !0;
            }
          }
          C.callback !== null && C.lane !== 0 && (t.flags |= 64, V = f.effects, V === null ? f.effects = [C] : V.push(C));
        } else ae = { eventTime: ae, lane: V, tag: C.tag, payload: C.payload, callback: C.callback, next: null }, G === null ? (M = G = ae, T = Q) : G = G.next = ae, k |= V;
        if (C = C.next, C === null) {
          if (C = f.shared.pending, C === null) break;
          V = C, C = V.next, V.next = null, f.lastBaseUpdate = V, f.shared.pending = null;
        }
      } while (!0);
      if (G === null && (T = Q), f.baseState = T, f.firstBaseUpdate = M, f.lastBaseUpdate = G, n = f.shared.interleaved, n !== null) {
        f = n;
        do
          k |= f.lane, f = f.next;
        while (f !== n);
      } else g === null && (f.shared.lanes = 0);
      yr |= k, t.lanes = k, t.memoizedState = Q;
    }
  }
  function dd(t, n, l) {
    if (t = n.effects, n.effects = null, t !== null) for (n = 0; n < t.length; n++) {
      var u = t[n], f = u.callback;
      if (f !== null) {
        if (u.callback = null, u = l, typeof f != "function") throw Error(i(191, f));
        f.call(u);
      }
    }
  }
  var Li = {}, mn = Wn(Li), Ni = Wn(Li), Ai = Wn(Li);
  function mr(t) {
    if (t === Li) throw Error(i(174));
    return t;
  }
  function Ia(t, n) {
    switch (Qe(Ai, n), Qe(Ni, t), Qe(mn, Li), t = n.nodeType, t) {
      case 9:
      case 11:
        n = (n = n.documentElement) ? n.namespaceURI : ee(null, "");
        break;
      default:
        t = t === 8 ? n.parentNode : n, n = t.namespaceURI || null, t = t.tagName, n = ee(n, t);
    }
    Xe(mn), Qe(mn, n);
  }
  function Qr() {
    Xe(mn), Xe(Ni), Xe(Ai);
  }
  function fd(t) {
    mr(Ai.current);
    var n = mr(mn.current), l = ee(n, t.type);
    n !== l && (Qe(Ni, t), Qe(mn, l));
  }
  function Da(t) {
    Ni.current === t && (Xe(mn), Xe(Ni));
  }
  var Ze = Wn(0);
  function Wo(t) {
    for (var n = t; n !== null; ) {
      if (n.tag === 13) {
        var l = n.memoizedState;
        if (l !== null && (l = l.dehydrated, l === null || l.data === "$?" || l.data === "$!")) return n;
      } else if (n.tag === 19 && n.memoizedProps.revealOrder !== void 0) {
        if ((n.flags & 128) !== 0) return n;
      } else if (n.child !== null) {
        n.child.return = n, n = n.child;
        continue;
      }
      if (n === t) break;
      for (; n.sibling === null; ) {
        if (n.return === null || n.return === t) return null;
        n = n.return;
      }
      n.sibling.return = n.return, n = n.sibling;
    }
    return null;
  }
  var Ma = [];
  function Oa() {
    for (var t = 0; t < Ma.length; t++) Ma[t]._workInProgressVersionPrimary = null;
    Ma.length = 0;
  }
  var Vo = ne.ReactCurrentDispatcher, Fa = ne.ReactCurrentBatchConfig, gr = 0, et = null, ut = null, ft = null, Go = !1, zi = !1, Pi = 0, Ug = 0;
  function vt() {
    throw Error(i(321));
  }
  function $a(t, n) {
    if (n === null) return !1;
    for (var l = 0; l < n.length && l < t.length; l++) if (!en(t[l], n[l])) return !1;
    return !0;
  }
  function Ba(t, n, l, u, f, g) {
    if (gr = g, et = n, n.memoizedState = null, n.updateQueue = null, n.lanes = 0, Vo.current = t === null || t.memoizedState === null ? Qg : Kg, t = l(u, f), zi) {
      g = 0;
      do {
        if (zi = !1, Pi = 0, 25 <= g) throw Error(i(301));
        g += 1, ft = ut = null, n.updateQueue = null, Vo.current = Yg, t = l(u, f);
      } while (zi);
    }
    if (Vo.current = Yo, n = ut !== null && ut.next !== null, gr = 0, ft = ut = et = null, Go = !1, n) throw Error(i(300));
    return t;
  }
  function Ha() {
    var t = Pi !== 0;
    return Pi = 0, t;
  }
  function gn() {
    var t = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
    return ft === null ? et.memoizedState = ft = t : ft = ft.next = t, ft;
  }
  function Wt() {
    if (ut === null) {
      var t = et.alternate;
      t = t !== null ? t.memoizedState : null;
    } else t = ut.next;
    var n = ft === null ? et.memoizedState : ft.next;
    if (n !== null) ft = n, ut = t;
    else {
      if (t === null) throw Error(i(310));
      ut = t, t = { memoizedState: ut.memoizedState, baseState: ut.baseState, baseQueue: ut.baseQueue, queue: ut.queue, next: null }, ft === null ? et.memoizedState = ft = t : ft = ft.next = t;
    }
    return ft;
  }
  function Ii(t, n) {
    return typeof n == "function" ? n(t) : n;
  }
  function qa(t) {
    var n = Wt(), l = n.queue;
    if (l === null) throw Error(i(311));
    l.lastRenderedReducer = t;
    var u = ut, f = u.baseQueue, g = l.pending;
    if (g !== null) {
      if (f !== null) {
        var k = f.next;
        f.next = g.next, g.next = k;
      }
      u.baseQueue = f = g, l.pending = null;
    }
    if (f !== null) {
      g = f.next, u = u.baseState;
      var C = k = null, T = null, M = g;
      do {
        var G = M.lane;
        if ((gr & G) === G) T !== null && (T = T.next = { lane: 0, action: M.action, hasEagerState: M.hasEagerState, eagerState: M.eagerState, next: null }), u = M.hasEagerState ? M.eagerState : t(u, M.action);
        else {
          var Q = {
            lane: G,
            action: M.action,
            hasEagerState: M.hasEagerState,
            eagerState: M.eagerState,
            next: null
          };
          T === null ? (C = T = Q, k = u) : T = T.next = Q, et.lanes |= G, yr |= G;
        }
        M = M.next;
      } while (M !== null && M !== g);
      T === null ? k = u : T.next = C, en(u, n.memoizedState) || (Rt = !0), n.memoizedState = u, n.baseState = k, n.baseQueue = T, l.lastRenderedState = u;
    }
    if (t = l.interleaved, t !== null) {
      f = t;
      do
        g = f.lane, et.lanes |= g, yr |= g, f = f.next;
      while (f !== t);
    } else f === null && (l.lanes = 0);
    return [n.memoizedState, l.dispatch];
  }
  function Ua(t) {
    var n = Wt(), l = n.queue;
    if (l === null) throw Error(i(311));
    l.lastRenderedReducer = t;
    var u = l.dispatch, f = l.pending, g = n.memoizedState;
    if (f !== null) {
      l.pending = null;
      var k = f = f.next;
      do
        g = t(g, k.action), k = k.next;
      while (k !== f);
      en(g, n.memoizedState) || (Rt = !0), n.memoizedState = g, n.baseQueue === null && (n.baseState = g), l.lastRenderedState = g;
    }
    return [g, u];
  }
  function pd() {
  }
  function hd(t, n) {
    var l = et, u = Wt(), f = n(), g = !en(u.memoizedState, f);
    if (g && (u.memoizedState = f, Rt = !0), u = u.queue, Wa(yd.bind(null, l, u, t), [t]), u.getSnapshot !== n || g || ft !== null && ft.memoizedState.tag & 1) {
      if (l.flags |= 2048, Di(9, gd.bind(null, l, u, f, n), void 0, null), pt === null) throw Error(i(349));
      (gr & 30) !== 0 || md(l, n, f);
    }
    return f;
  }
  function md(t, n, l) {
    t.flags |= 16384, t = { getSnapshot: n, value: l }, n = et.updateQueue, n === null ? (n = { lastEffect: null, stores: null }, et.updateQueue = n, n.stores = [t]) : (l = n.stores, l === null ? n.stores = [t] : l.push(t));
  }
  function gd(t, n, l, u) {
    n.value = l, n.getSnapshot = u, vd(n) && xd(t);
  }
  function yd(t, n, l) {
    return l(function() {
      vd(n) && xd(t);
    });
  }
  function vd(t) {
    var n = t.getSnapshot;
    t = t.value;
    try {
      var l = n();
      return !en(t, l);
    } catch {
      return !0;
    }
  }
  function xd(t) {
    var n = Rn(t, 1);
    n !== null && ln(n, t, 1, -1);
  }
  function kd(t) {
    var n = gn();
    return typeof t == "function" && (t = t()), n.memoizedState = n.baseState = t, t = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: Ii, lastRenderedState: t }, n.queue = t, t = t.dispatch = Gg.bind(null, et, t), [n.memoizedState, t];
  }
  function Di(t, n, l, u) {
    return t = { tag: t, create: n, destroy: l, deps: u, next: null }, n = et.updateQueue, n === null ? (n = { lastEffect: null, stores: null }, et.updateQueue = n, n.lastEffect = t.next = t) : (l = n.lastEffect, l === null ? n.lastEffect = t.next = t : (u = l.next, l.next = t, t.next = u, n.lastEffect = t)), t;
  }
  function wd() {
    return Wt().memoizedState;
  }
  function Qo(t, n, l, u) {
    var f = gn();
    et.flags |= t, f.memoizedState = Di(1 | n, l, void 0, u === void 0 ? null : u);
  }
  function Ko(t, n, l, u) {
    var f = Wt();
    u = u === void 0 ? null : u;
    var g = void 0;
    if (ut !== null) {
      var k = ut.memoizedState;
      if (g = k.destroy, u !== null && $a(u, k.deps)) {
        f.memoizedState = Di(n, l, g, u);
        return;
      }
    }
    et.flags |= t, f.memoizedState = Di(1 | n, l, g, u);
  }
  function bd(t, n) {
    return Qo(8390656, 8, t, n);
  }
  function Wa(t, n) {
    return Ko(2048, 8, t, n);
  }
  function Sd(t, n) {
    return Ko(4, 2, t, n);
  }
  function Cd(t, n) {
    return Ko(4, 4, t, n);
  }
  function Ed(t, n) {
    if (typeof n == "function") return t = t(), n(t), function() {
      n(null);
    };
    if (n != null) return t = t(), n.current = t, function() {
      n.current = null;
    };
  }
  function _d(t, n, l) {
    return l = l != null ? l.concat([t]) : null, Ko(4, 4, Ed.bind(null, n, t), l);
  }
  function Va() {
  }
  function Td(t, n) {
    var l = Wt();
    n = n === void 0 ? null : n;
    var u = l.memoizedState;
    return u !== null && n !== null && $a(n, u[1]) ? u[0] : (l.memoizedState = [t, n], t);
  }
  function jd(t, n) {
    var l = Wt();
    n = n === void 0 ? null : n;
    var u = l.memoizedState;
    return u !== null && n !== null && $a(n, u[1]) ? u[0] : (t = t(), l.memoizedState = [t, n], t);
  }
  function Rd(t, n, l) {
    return (gr & 21) === 0 ? (t.baseState && (t.baseState = !1, Rt = !0), t.memoizedState = l) : (en(l, n) || (l = oc(), et.lanes |= l, yr |= l, t.baseState = !0), n);
  }
  function Wg(t, n) {
    var l = qe;
    qe = l !== 0 && 4 > l ? l : 4, t(!0);
    var u = Fa.transition;
    Fa.transition = {};
    try {
      t(!1), n();
    } finally {
      qe = l, Fa.transition = u;
    }
  }
  function Ld() {
    return Wt().memoizedState;
  }
  function Vg(t, n, l) {
    var u = Zn(t);
    if (l = { lane: u, action: l, hasEagerState: !1, eagerState: null, next: null }, Nd(t)) Ad(n, l);
    else if (l = sd(t, n, l, u), l !== null) {
      var f = Et();
      ln(l, t, u, f), zd(l, n, u);
    }
  }
  function Gg(t, n, l) {
    var u = Zn(t), f = { lane: u, action: l, hasEagerState: !1, eagerState: null, next: null };
    if (Nd(t)) Ad(n, f);
    else {
      var g = t.alternate;
      if (t.lanes === 0 && (g === null || g.lanes === 0) && (g = n.lastRenderedReducer, g !== null)) try {
        var k = n.lastRenderedState, C = g(k, l);
        if (f.hasEagerState = !0, f.eagerState = C, en(C, k)) {
          var T = n.interleaved;
          T === null ? (f.next = f, za(n)) : (f.next = T.next, T.next = f), n.interleaved = f;
          return;
        }
      } catch {
      } finally {
      }
      l = sd(t, n, f, u), l !== null && (f = Et(), ln(l, t, u, f), zd(l, n, u));
    }
  }
  function Nd(t) {
    var n = t.alternate;
    return t === et || n !== null && n === et;
  }
  function Ad(t, n) {
    zi = Go = !0;
    var l = t.pending;
    l === null ? n.next = n : (n.next = l.next, l.next = n), t.pending = n;
  }
  function zd(t, n, l) {
    if ((l & 4194240) !== 0) {
      var u = n.lanes;
      u &= t.pendingLanes, l |= u, n.lanes = l, Ql(t, l);
    }
  }
  var Yo = { readContext: Ut, useCallback: vt, useContext: vt, useEffect: vt, useImperativeHandle: vt, useInsertionEffect: vt, useLayoutEffect: vt, useMemo: vt, useReducer: vt, useRef: vt, useState: vt, useDebugValue: vt, useDeferredValue: vt, useTransition: vt, useMutableSource: vt, useSyncExternalStore: vt, useId: vt, unstable_isNewReconciler: !1 }, Qg = { readContext: Ut, useCallback: function(t, n) {
    return gn().memoizedState = [t, n === void 0 ? null : n], t;
  }, useContext: Ut, useEffect: bd, useImperativeHandle: function(t, n, l) {
    return l = l != null ? l.concat([t]) : null, Qo(
      4194308,
      4,
      Ed.bind(null, n, t),
      l
    );
  }, useLayoutEffect: function(t, n) {
    return Qo(4194308, 4, t, n);
  }, useInsertionEffect: function(t, n) {
    return Qo(4, 2, t, n);
  }, useMemo: function(t, n) {
    var l = gn();
    return n = n === void 0 ? null : n, t = t(), l.memoizedState = [t, n], t;
  }, useReducer: function(t, n, l) {
    var u = gn();
    return n = l !== void 0 ? l(n) : n, u.memoizedState = u.baseState = n, t = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: t, lastRenderedState: n }, u.queue = t, t = t.dispatch = Vg.bind(null, et, t), [u.memoizedState, t];
  }, useRef: function(t) {
    var n = gn();
    return t = { current: t }, n.memoizedState = t;
  }, useState: kd, useDebugValue: Va, useDeferredValue: function(t) {
    return gn().memoizedState = t;
  }, useTransition: function() {
    var t = kd(!1), n = t[0];
    return t = Wg.bind(null, t[1]), gn().memoizedState = t, [n, t];
  }, useMutableSource: function() {
  }, useSyncExternalStore: function(t, n, l) {
    var u = et, f = gn();
    if (Je) {
      if (l === void 0) throw Error(i(407));
      l = l();
    } else {
      if (l = n(), pt === null) throw Error(i(349));
      (gr & 30) !== 0 || md(u, n, l);
    }
    f.memoizedState = l;
    var g = { value: l, getSnapshot: n };
    return f.queue = g, bd(yd.bind(
      null,
      u,
      g,
      t
    ), [t]), u.flags |= 2048, Di(9, gd.bind(null, u, g, l, n), void 0, null), l;
  }, useId: function() {
    var t = gn(), n = pt.identifierPrefix;
    if (Je) {
      var l = jn, u = Tn;
      l = (u & ~(1 << 32 - Zt(u) - 1)).toString(32) + l, n = ":" + n + "R" + l, l = Pi++, 0 < l && (n += "H" + l.toString(32)), n += ":";
    } else l = Ug++, n = ":" + n + "r" + l.toString(32) + ":";
    return t.memoizedState = n;
  }, unstable_isNewReconciler: !1 }, Kg = {
    readContext: Ut,
    useCallback: Td,
    useContext: Ut,
    useEffect: Wa,
    useImperativeHandle: _d,
    useInsertionEffect: Sd,
    useLayoutEffect: Cd,
    useMemo: jd,
    useReducer: qa,
    useRef: wd,
    useState: function() {
      return qa(Ii);
    },
    useDebugValue: Va,
    useDeferredValue: function(t) {
      var n = Wt();
      return Rd(n, ut.memoizedState, t);
    },
    useTransition: function() {
      var t = qa(Ii)[0], n = Wt().memoizedState;
      return [t, n];
    },
    useMutableSource: pd,
    useSyncExternalStore: hd,
    useId: Ld,
    unstable_isNewReconciler: !1
  }, Yg = { readContext: Ut, useCallback: Td, useContext: Ut, useEffect: Wa, useImperativeHandle: _d, useInsertionEffect: Sd, useLayoutEffect: Cd, useMemo: jd, useReducer: Ua, useRef: wd, useState: function() {
    return Ua(Ii);
  }, useDebugValue: Va, useDeferredValue: function(t) {
    var n = Wt();
    return ut === null ? n.memoizedState = t : Rd(n, ut.memoizedState, t);
  }, useTransition: function() {
    var t = Ua(Ii)[0], n = Wt().memoizedState;
    return [t, n];
  }, useMutableSource: pd, useSyncExternalStore: hd, useId: Ld, unstable_isNewReconciler: !1 };
  function nn(t, n) {
    if (t && t.defaultProps) {
      n = b({}, n), t = t.defaultProps;
      for (var l in t) n[l] === void 0 && (n[l] = t[l]);
      return n;
    }
    return n;
  }
  function Ga(t, n, l, u) {
    n = t.memoizedState, l = l(u, n), l = l == null ? n : b({}, n, l), t.memoizedState = l, t.lanes === 0 && (t.updateQueue.baseState = l);
  }
  var Xo = { isMounted: function(t) {
    return (t = t._reactInternals) ? ur(t) === t : !1;
  }, enqueueSetState: function(t, n, l) {
    t = t._reactInternals;
    var u = Et(), f = Zn(t), g = Ln(u, f);
    g.payload = n, l != null && (g.callback = l), n = Kn(t, g, f), n !== null && (ln(n, t, f, u), qo(n, t, f));
  }, enqueueReplaceState: function(t, n, l) {
    t = t._reactInternals;
    var u = Et(), f = Zn(t), g = Ln(u, f);
    g.tag = 1, g.payload = n, l != null && (g.callback = l), n = Kn(t, g, f), n !== null && (ln(n, t, f, u), qo(n, t, f));
  }, enqueueForceUpdate: function(t, n) {
    t = t._reactInternals;
    var l = Et(), u = Zn(t), f = Ln(l, u);
    f.tag = 2, n != null && (f.callback = n), n = Kn(t, f, u), n !== null && (ln(n, t, u, l), qo(n, t, u));
  } };
  function Pd(t, n, l, u, f, g, k) {
    return t = t.stateNode, typeof t.shouldComponentUpdate == "function" ? t.shouldComponentUpdate(u, g, k) : n.prototype && n.prototype.isPureReactComponent ? !bi(l, u) || !bi(f, g) : !0;
  }
  function Id(t, n, l) {
    var u = !1, f = Vn, g = n.contextType;
    return typeof g == "object" && g !== null ? g = Ut(g) : (f = jt(n) ? dr : yt.current, u = n.contextTypes, g = (u = u != null) ? Br(t, f) : Vn), n = new n(l, g), t.memoizedState = n.state !== null && n.state !== void 0 ? n.state : null, n.updater = Xo, t.stateNode = n, n._reactInternals = t, u && (t = t.stateNode, t.__reactInternalMemoizedUnmaskedChildContext = f, t.__reactInternalMemoizedMaskedChildContext = g), n;
  }
  function Dd(t, n, l, u) {
    t = n.state, typeof n.componentWillReceiveProps == "function" && n.componentWillReceiveProps(l, u), typeof n.UNSAFE_componentWillReceiveProps == "function" && n.UNSAFE_componentWillReceiveProps(l, u), n.state !== t && Xo.enqueueReplaceState(n, n.state, null);
  }
  function Qa(t, n, l, u) {
    var f = t.stateNode;
    f.props = l, f.state = t.memoizedState, f.refs = {}, Pa(t);
    var g = n.contextType;
    typeof g == "object" && g !== null ? f.context = Ut(g) : (g = jt(n) ? dr : yt.current, f.context = Br(t, g)), f.state = t.memoizedState, g = n.getDerivedStateFromProps, typeof g == "function" && (Ga(t, n, g, l), f.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof f.getSnapshotBeforeUpdate == "function" || typeof f.UNSAFE_componentWillMount != "function" && typeof f.componentWillMount != "function" || (n = f.state, typeof f.componentWillMount == "function" && f.componentWillMount(), typeof f.UNSAFE_componentWillMount == "function" && f.UNSAFE_componentWillMount(), n !== f.state && Xo.enqueueReplaceState(f, f.state, null), Uo(t, l, f, u), f.state = t.memoizedState), typeof f.componentDidMount == "function" && (t.flags |= 4194308);
  }
  function Kr(t, n) {
    try {
      var l = "", u = n;
      do
        l += ye(u), u = u.return;
      while (u);
      var f = l;
    } catch (g) {
      f = `
Error generating stack: ` + g.message + `
` + g.stack;
    }
    return { value: t, source: n, stack: f, digest: null };
  }
  function Ka(t, n, l) {
    return { value: t, source: null, stack: l ?? null, digest: n ?? null };
  }
  function Ya(t, n) {
    try {
      console.error(n.value);
    } catch (l) {
      setTimeout(function() {
        throw l;
      });
    }
  }
  var Xg = typeof WeakMap == "function" ? WeakMap : Map;
  function Md(t, n, l) {
    l = Ln(-1, l), l.tag = 3, l.payload = { element: null };
    var u = n.value;
    return l.callback = function() {
      il || (il = !0, ds = u), Ya(t, n);
    }, l;
  }
  function Od(t, n, l) {
    l = Ln(-1, l), l.tag = 3;
    var u = t.type.getDerivedStateFromError;
    if (typeof u == "function") {
      var f = n.value;
      l.payload = function() {
        return u(f);
      }, l.callback = function() {
        Ya(t, n);
      };
    }
    var g = t.stateNode;
    return g !== null && typeof g.componentDidCatch == "function" && (l.callback = function() {
      Ya(t, n), typeof u != "function" && (Xn === null ? Xn = /* @__PURE__ */ new Set([this]) : Xn.add(this));
      var k = n.stack;
      this.componentDidCatch(n.value, { componentStack: k !== null ? k : "" });
    }), l;
  }
  function Fd(t, n, l) {
    var u = t.pingCache;
    if (u === null) {
      u = t.pingCache = new Xg();
      var f = /* @__PURE__ */ new Set();
      u.set(n, f);
    } else f = u.get(n), f === void 0 && (f = /* @__PURE__ */ new Set(), u.set(n, f));
    f.has(l) || (f.add(l), t = dy.bind(null, t, n, l), n.then(t, t));
  }
  function $d(t) {
    do {
      var n;
      if ((n = t.tag === 13) && (n = t.memoizedState, n = n !== null ? n.dehydrated !== null : !0), n) return t;
      t = t.return;
    } while (t !== null);
    return null;
  }
  function Bd(t, n, l, u, f) {
    return (t.mode & 1) === 0 ? (t === n ? t.flags |= 65536 : (t.flags |= 128, l.flags |= 131072, l.flags &= -52805, l.tag === 1 && (l.alternate === null ? l.tag = 17 : (n = Ln(-1, 1), n.tag = 2, Kn(l, n, 1))), l.lanes |= 1), t) : (t.flags |= 65536, t.lanes = f, t);
  }
  var Jg = ne.ReactCurrentOwner, Rt = !1;
  function Ct(t, n, l, u) {
    n.child = t === null ? ad(n, null, l, u) : Wr(n, t.child, l, u);
  }
  function Hd(t, n, l, u, f) {
    l = l.render;
    var g = n.ref;
    return Gr(n, f), u = Ba(t, n, l, u, g, f), l = Ha(), t !== null && !Rt ? (n.updateQueue = t.updateQueue, n.flags &= -2053, t.lanes &= ~f, Nn(t, n, f)) : (Je && l && Ca(n), n.flags |= 1, Ct(t, n, u, f), n.child);
  }
  function qd(t, n, l, u, f) {
    if (t === null) {
      var g = l.type;
      return typeof g == "function" && !vs(g) && g.defaultProps === void 0 && l.compare === null && l.defaultProps === void 0 ? (n.tag = 15, n.type = g, Ud(t, n, g, u, f)) : (t = cl(l.type, null, u, n, n.mode, f), t.ref = n.ref, t.return = n, n.child = t);
    }
    if (g = t.child, (t.lanes & f) === 0) {
      var k = g.memoizedProps;
      if (l = l.compare, l = l !== null ? l : bi, l(k, u) && t.ref === n.ref) return Nn(t, n, f);
    }
    return n.flags |= 1, t = tr(g, u), t.ref = n.ref, t.return = n, n.child = t;
  }
  function Ud(t, n, l, u, f) {
    if (t !== null) {
      var g = t.memoizedProps;
      if (bi(g, u) && t.ref === n.ref) if (Rt = !1, n.pendingProps = u = g, (t.lanes & f) !== 0) (t.flags & 131072) !== 0 && (Rt = !0);
      else return n.lanes = t.lanes, Nn(t, n, f);
    }
    return Xa(t, n, l, u, f);
  }
  function Wd(t, n, l) {
    var u = n.pendingProps, f = u.children, g = t !== null ? t.memoizedState : null;
    if (u.mode === "hidden") if ((n.mode & 1) === 0) n.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, Qe(Xr, Ot), Ot |= l;
    else {
      if ((l & 1073741824) === 0) return t = g !== null ? g.baseLanes | l : l, n.lanes = n.childLanes = 1073741824, n.memoizedState = { baseLanes: t, cachePool: null, transitions: null }, n.updateQueue = null, Qe(Xr, Ot), Ot |= t, null;
      n.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, u = g !== null ? g.baseLanes : l, Qe(Xr, Ot), Ot |= u;
    }
    else g !== null ? (u = g.baseLanes | l, n.memoizedState = null) : u = l, Qe(Xr, Ot), Ot |= u;
    return Ct(t, n, f, l), n.child;
  }
  function Vd(t, n) {
    var l = n.ref;
    (t === null && l !== null || t !== null && t.ref !== l) && (n.flags |= 512, n.flags |= 2097152);
  }
  function Xa(t, n, l, u, f) {
    var g = jt(l) ? dr : yt.current;
    return g = Br(n, g), Gr(n, f), l = Ba(t, n, l, u, g, f), u = Ha(), t !== null && !Rt ? (n.updateQueue = t.updateQueue, n.flags &= -2053, t.lanes &= ~f, Nn(t, n, f)) : (Je && u && Ca(n), n.flags |= 1, Ct(t, n, l, f), n.child);
  }
  function Gd(t, n, l, u, f) {
    if (jt(l)) {
      var g = !0;
      Io(n);
    } else g = !1;
    if (Gr(n, f), n.stateNode === null) Zo(t, n), Id(n, l, u), Qa(n, l, u, f), u = !0;
    else if (t === null) {
      var k = n.stateNode, C = n.memoizedProps;
      k.props = C;
      var T = k.context, M = l.contextType;
      typeof M == "object" && M !== null ? M = Ut(M) : (M = jt(l) ? dr : yt.current, M = Br(n, M));
      var G = l.getDerivedStateFromProps, Q = typeof G == "function" || typeof k.getSnapshotBeforeUpdate == "function";
      Q || typeof k.UNSAFE_componentWillReceiveProps != "function" && typeof k.componentWillReceiveProps != "function" || (C !== u || T !== M) && Dd(n, k, u, M), Qn = !1;
      var V = n.memoizedState;
      k.state = V, Uo(n, u, k, f), T = n.memoizedState, C !== u || V !== T || Tt.current || Qn ? (typeof G == "function" && (Ga(n, l, G, u), T = n.memoizedState), (C = Qn || Pd(n, l, C, u, V, T, M)) ? (Q || typeof k.UNSAFE_componentWillMount != "function" && typeof k.componentWillMount != "function" || (typeof k.componentWillMount == "function" && k.componentWillMount(), typeof k.UNSAFE_componentWillMount == "function" && k.UNSAFE_componentWillMount()), typeof k.componentDidMount == "function" && (n.flags |= 4194308)) : (typeof k.componentDidMount == "function" && (n.flags |= 4194308), n.memoizedProps = u, n.memoizedState = T), k.props = u, k.state = T, k.context = M, u = C) : (typeof k.componentDidMount == "function" && (n.flags |= 4194308), u = !1);
    } else {
      k = n.stateNode, ud(t, n), C = n.memoizedProps, M = n.type === n.elementType ? C : nn(n.type, C), k.props = M, Q = n.pendingProps, V = k.context, T = l.contextType, typeof T == "object" && T !== null ? T = Ut(T) : (T = jt(l) ? dr : yt.current, T = Br(n, T));
      var ae = l.getDerivedStateFromProps;
      (G = typeof ae == "function" || typeof k.getSnapshotBeforeUpdate == "function") || typeof k.UNSAFE_componentWillReceiveProps != "function" && typeof k.componentWillReceiveProps != "function" || (C !== Q || V !== T) && Dd(n, k, u, T), Qn = !1, V = n.memoizedState, k.state = V, Uo(n, u, k, f);
      var de = n.memoizedState;
      C !== Q || V !== de || Tt.current || Qn ? (typeof ae == "function" && (Ga(n, l, ae, u), de = n.memoizedState), (M = Qn || Pd(n, l, M, u, V, de, T) || !1) ? (G || typeof k.UNSAFE_componentWillUpdate != "function" && typeof k.componentWillUpdate != "function" || (typeof k.componentWillUpdate == "function" && k.componentWillUpdate(u, de, T), typeof k.UNSAFE_componentWillUpdate == "function" && k.UNSAFE_componentWillUpdate(u, de, T)), typeof k.componentDidUpdate == "function" && (n.flags |= 4), typeof k.getSnapshotBeforeUpdate == "function" && (n.flags |= 1024)) : (typeof k.componentDidUpdate != "function" || C === t.memoizedProps && V === t.memoizedState || (n.flags |= 4), typeof k.getSnapshotBeforeUpdate != "function" || C === t.memoizedProps && V === t.memoizedState || (n.flags |= 1024), n.memoizedProps = u, n.memoizedState = de), k.props = u, k.state = de, k.context = T, u = M) : (typeof k.componentDidUpdate != "function" || C === t.memoizedProps && V === t.memoizedState || (n.flags |= 4), typeof k.getSnapshotBeforeUpdate != "function" || C === t.memoizedProps && V === t.memoizedState || (n.flags |= 1024), u = !1);
    }
    return Ja(t, n, l, u, g, f);
  }
  function Ja(t, n, l, u, f, g) {
    Vd(t, n);
    var k = (n.flags & 128) !== 0;
    if (!u && !k) return f && Jc(n, l, !1), Nn(t, n, g);
    u = n.stateNode, Jg.current = n;
    var C = k && typeof l.getDerivedStateFromError != "function" ? null : u.render();
    return n.flags |= 1, t !== null && k ? (n.child = Wr(n, t.child, null, g), n.child = Wr(n, null, C, g)) : Ct(t, n, C, g), n.memoizedState = u.state, f && Jc(n, l, !0), n.child;
  }
  function Qd(t) {
    var n = t.stateNode;
    n.pendingContext ? Yc(t, n.pendingContext, n.pendingContext !== n.context) : n.context && Yc(t, n.context, !1), Ia(t, n.containerInfo);
  }
  function Kd(t, n, l, u, f) {
    return Ur(), ja(f), n.flags |= 256, Ct(t, n, l, u), n.child;
  }
  var Za = { dehydrated: null, treeContext: null, retryLane: 0 };
  function es(t) {
    return { baseLanes: t, cachePool: null, transitions: null };
  }
  function Yd(t, n, l) {
    var u = n.pendingProps, f = Ze.current, g = !1, k = (n.flags & 128) !== 0, C;
    if ((C = k) || (C = t !== null && t.memoizedState === null ? !1 : (f & 2) !== 0), C ? (g = !0, n.flags &= -129) : (t === null || t.memoizedState !== null) && (f |= 1), Qe(Ze, f & 1), t === null)
      return Ta(n), t = n.memoizedState, t !== null && (t = t.dehydrated, t !== null) ? ((n.mode & 1) === 0 ? n.lanes = 1 : t.data === "$!" ? n.lanes = 8 : n.lanes = 1073741824, null) : (k = u.children, t = u.fallback, g ? (u = n.mode, g = n.child, k = { mode: "hidden", children: k }, (u & 1) === 0 && g !== null ? (g.childLanes = 0, g.pendingProps = k) : g = dl(k, u, 0, null), t = wr(t, u, l, null), g.return = n, t.return = n, g.sibling = t, n.child = g, n.child.memoizedState = es(l), n.memoizedState = Za, t) : ts(n, k));
    if (f = t.memoizedState, f !== null && (C = f.dehydrated, C !== null)) return Zg(t, n, k, u, C, f, l);
    if (g) {
      g = u.fallback, k = n.mode, f = t.child, C = f.sibling;
      var T = { mode: "hidden", children: u.children };
      return (k & 1) === 0 && n.child !== f ? (u = n.child, u.childLanes = 0, u.pendingProps = T, n.deletions = null) : (u = tr(f, T), u.subtreeFlags = f.subtreeFlags & 14680064), C !== null ? g = tr(C, g) : (g = wr(g, k, l, null), g.flags |= 2), g.return = n, u.return = n, u.sibling = g, n.child = u, u = g, g = n.child, k = t.child.memoizedState, k = k === null ? es(l) : { baseLanes: k.baseLanes | l, cachePool: null, transitions: k.transitions }, g.memoizedState = k, g.childLanes = t.childLanes & ~l, n.memoizedState = Za, u;
    }
    return g = t.child, t = g.sibling, u = tr(g, { mode: "visible", children: u.children }), (n.mode & 1) === 0 && (u.lanes = l), u.return = n, u.sibling = null, t !== null && (l = n.deletions, l === null ? (n.deletions = [t], n.flags |= 16) : l.push(t)), n.child = u, n.memoizedState = null, u;
  }
  function ts(t, n) {
    return n = dl({ mode: "visible", children: n }, t.mode, 0, null), n.return = t, t.child = n;
  }
  function Jo(t, n, l, u) {
    return u !== null && ja(u), Wr(n, t.child, null, l), t = ts(n, n.pendingProps.children), t.flags |= 2, n.memoizedState = null, t;
  }
  function Zg(t, n, l, u, f, g, k) {
    if (l)
      return n.flags & 256 ? (n.flags &= -257, u = Ka(Error(i(422))), Jo(t, n, k, u)) : n.memoizedState !== null ? (n.child = t.child, n.flags |= 128, null) : (g = u.fallback, f = n.mode, u = dl({ mode: "visible", children: u.children }, f, 0, null), g = wr(g, f, k, null), g.flags |= 2, u.return = n, g.return = n, u.sibling = g, n.child = u, (n.mode & 1) !== 0 && Wr(n, t.child, null, k), n.child.memoizedState = es(k), n.memoizedState = Za, g);
    if ((n.mode & 1) === 0) return Jo(t, n, k, null);
    if (f.data === "$!") {
      if (u = f.nextSibling && f.nextSibling.dataset, u) var C = u.dgst;
      return u = C, g = Error(i(419)), u = Ka(g, u, void 0), Jo(t, n, k, u);
    }
    if (C = (k & t.childLanes) !== 0, Rt || C) {
      if (u = pt, u !== null) {
        switch (k & -k) {
          case 4:
            f = 2;
            break;
          case 16:
            f = 8;
            break;
          case 64:
          case 128:
          case 256:
          case 512:
          case 1024:
          case 2048:
          case 4096:
          case 8192:
          case 16384:
          case 32768:
          case 65536:
          case 131072:
          case 262144:
          case 524288:
          case 1048576:
          case 2097152:
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
          case 67108864:
            f = 32;
            break;
          case 536870912:
            f = 268435456;
            break;
          default:
            f = 0;
        }
        f = (f & (u.suspendedLanes | k)) !== 0 ? 0 : f, f !== 0 && f !== g.retryLane && (g.retryLane = f, Rn(t, f), ln(u, t, f, -1));
      }
      return ys(), u = Ka(Error(i(421))), Jo(t, n, k, u);
    }
    return f.data === "$?" ? (n.flags |= 128, n.child = t.child, n = fy.bind(null, t), f._reactRetry = n, null) : (t = g.treeContext, Mt = Un(f.nextSibling), Dt = n, Je = !0, tn = null, t !== null && (Ht[qt++] = Tn, Ht[qt++] = jn, Ht[qt++] = fr, Tn = t.id, jn = t.overflow, fr = n), n = ts(n, u.children), n.flags |= 4096, n);
  }
  function Xd(t, n, l) {
    t.lanes |= n;
    var u = t.alternate;
    u !== null && (u.lanes |= n), Aa(t.return, n, l);
  }
  function ns(t, n, l, u, f) {
    var g = t.memoizedState;
    g === null ? t.memoizedState = { isBackwards: n, rendering: null, renderingStartTime: 0, last: u, tail: l, tailMode: f } : (g.isBackwards = n, g.rendering = null, g.renderingStartTime = 0, g.last = u, g.tail = l, g.tailMode = f);
  }
  function Jd(t, n, l) {
    var u = n.pendingProps, f = u.revealOrder, g = u.tail;
    if (Ct(t, n, u.children, l), u = Ze.current, (u & 2) !== 0) u = u & 1 | 2, n.flags |= 128;
    else {
      if (t !== null && (t.flags & 128) !== 0) e: for (t = n.child; t !== null; ) {
        if (t.tag === 13) t.memoizedState !== null && Xd(t, l, n);
        else if (t.tag === 19) Xd(t, l, n);
        else if (t.child !== null) {
          t.child.return = t, t = t.child;
          continue;
        }
        if (t === n) break e;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === n) break e;
          t = t.return;
        }
        t.sibling.return = t.return, t = t.sibling;
      }
      u &= 1;
    }
    if (Qe(Ze, u), (n.mode & 1) === 0) n.memoizedState = null;
    else switch (f) {
      case "forwards":
        for (l = n.child, f = null; l !== null; ) t = l.alternate, t !== null && Wo(t) === null && (f = l), l = l.sibling;
        l = f, l === null ? (f = n.child, n.child = null) : (f = l.sibling, l.sibling = null), ns(n, !1, f, l, g);
        break;
      case "backwards":
        for (l = null, f = n.child, n.child = null; f !== null; ) {
          if (t = f.alternate, t !== null && Wo(t) === null) {
            n.child = f;
            break;
          }
          t = f.sibling, f.sibling = l, l = f, f = t;
        }
        ns(n, !0, l, null, g);
        break;
      case "together":
        ns(n, !1, null, null, void 0);
        break;
      default:
        n.memoizedState = null;
    }
    return n.child;
  }
  function Zo(t, n) {
    (n.mode & 1) === 0 && t !== null && (t.alternate = null, n.alternate = null, n.flags |= 2);
  }
  function Nn(t, n, l) {
    if (t !== null && (n.dependencies = t.dependencies), yr |= n.lanes, (l & n.childLanes) === 0) return null;
    if (t !== null && n.child !== t.child) throw Error(i(153));
    if (n.child !== null) {
      for (t = n.child, l = tr(t, t.pendingProps), n.child = l, l.return = n; t.sibling !== null; ) t = t.sibling, l = l.sibling = tr(t, t.pendingProps), l.return = n;
      l.sibling = null;
    }
    return n.child;
  }
  function ey(t, n, l) {
    switch (n.tag) {
      case 3:
        Qd(n), Ur();
        break;
      case 5:
        fd(n);
        break;
      case 1:
        jt(n.type) && Io(n);
        break;
      case 4:
        Ia(n, n.stateNode.containerInfo);
        break;
      case 10:
        var u = n.type._context, f = n.memoizedProps.value;
        Qe(Bo, u._currentValue), u._currentValue = f;
        break;
      case 13:
        if (u = n.memoizedState, u !== null)
          return u.dehydrated !== null ? (Qe(Ze, Ze.current & 1), n.flags |= 128, null) : (l & n.child.childLanes) !== 0 ? Yd(t, n, l) : (Qe(Ze, Ze.current & 1), t = Nn(t, n, l), t !== null ? t.sibling : null);
        Qe(Ze, Ze.current & 1);
        break;
      case 19:
        if (u = (l & n.childLanes) !== 0, (t.flags & 128) !== 0) {
          if (u) return Jd(t, n, l);
          n.flags |= 128;
        }
        if (f = n.memoizedState, f !== null && (f.rendering = null, f.tail = null, f.lastEffect = null), Qe(Ze, Ze.current), u) break;
        return null;
      case 22:
      case 23:
        return n.lanes = 0, Wd(t, n, l);
    }
    return Nn(t, n, l);
  }
  var Zd, rs, ef, tf;
  Zd = function(t, n) {
    for (var l = n.child; l !== null; ) {
      if (l.tag === 5 || l.tag === 6) t.appendChild(l.stateNode);
      else if (l.tag !== 4 && l.child !== null) {
        l.child.return = l, l = l.child;
        continue;
      }
      if (l === n) break;
      for (; l.sibling === null; ) {
        if (l.return === null || l.return === n) return;
        l = l.return;
      }
      l.sibling.return = l.return, l = l.sibling;
    }
  }, rs = function() {
  }, ef = function(t, n, l, u) {
    var f = t.memoizedProps;
    if (f !== u) {
      t = n.stateNode, mr(mn.current);
      var g = null;
      switch (l) {
        case "input":
          f = Ae(t, f), u = Ae(t, u), g = [];
          break;
        case "select":
          f = b({}, f, { value: void 0 }), u = b({}, u, { value: void 0 }), g = [];
          break;
        case "textarea":
          f = cn(t, f), u = cn(t, u), g = [];
          break;
        default:
          typeof f.onClick != "function" && typeof u.onClick == "function" && (t.onclick = Ao);
      }
      Ee(l, u);
      var k;
      l = null;
      for (M in f) if (!u.hasOwnProperty(M) && f.hasOwnProperty(M) && f[M] != null) if (M === "style") {
        var C = f[M];
        for (k in C) C.hasOwnProperty(k) && (l || (l = {}), l[k] = "");
      } else M !== "dangerouslySetInnerHTML" && M !== "children" && M !== "suppressContentEditableWarning" && M !== "suppressHydrationWarning" && M !== "autoFocus" && (a.hasOwnProperty(M) ? g || (g = []) : (g = g || []).push(M, null));
      for (M in u) {
        var T = u[M];
        if (C = f != null ? f[M] : void 0, u.hasOwnProperty(M) && T !== C && (T != null || C != null)) if (M === "style") if (C) {
          for (k in C) !C.hasOwnProperty(k) || T && T.hasOwnProperty(k) || (l || (l = {}), l[k] = "");
          for (k in T) T.hasOwnProperty(k) && C[k] !== T[k] && (l || (l = {}), l[k] = T[k]);
        } else l || (g || (g = []), g.push(
          M,
          l
        )), l = T;
        else M === "dangerouslySetInnerHTML" ? (T = T ? T.__html : void 0, C = C ? C.__html : void 0, T != null && C !== T && (g = g || []).push(M, T)) : M === "children" ? typeof T != "string" && typeof T != "number" || (g = g || []).push(M, "" + T) : M !== "suppressContentEditableWarning" && M !== "suppressHydrationWarning" && (a.hasOwnProperty(M) ? (T != null && M === "onScroll" && Ye("scroll", t), g || C === T || (g = [])) : (g = g || []).push(M, T));
      }
      l && (g = g || []).push("style", l);
      var M = g;
      (n.updateQueue = M) && (n.flags |= 4);
    }
  }, tf = function(t, n, l, u) {
    l !== u && (n.flags |= 4);
  };
  function Mi(t, n) {
    if (!Je) switch (t.tailMode) {
      case "hidden":
        n = t.tail;
        for (var l = null; n !== null; ) n.alternate !== null && (l = n), n = n.sibling;
        l === null ? t.tail = null : l.sibling = null;
        break;
      case "collapsed":
        l = t.tail;
        for (var u = null; l !== null; ) l.alternate !== null && (u = l), l = l.sibling;
        u === null ? n || t.tail === null ? t.tail = null : t.tail.sibling = null : u.sibling = null;
    }
  }
  function xt(t) {
    var n = t.alternate !== null && t.alternate.child === t.child, l = 0, u = 0;
    if (n) for (var f = t.child; f !== null; ) l |= f.lanes | f.childLanes, u |= f.subtreeFlags & 14680064, u |= f.flags & 14680064, f.return = t, f = f.sibling;
    else for (f = t.child; f !== null; ) l |= f.lanes | f.childLanes, u |= f.subtreeFlags, u |= f.flags, f.return = t, f = f.sibling;
    return t.subtreeFlags |= u, t.childLanes = l, n;
  }
  function ty(t, n, l) {
    var u = n.pendingProps;
    switch (Ea(n), n.tag) {
      case 2:
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return xt(n), null;
      case 1:
        return jt(n.type) && Po(), xt(n), null;
      case 3:
        return u = n.stateNode, Qr(), Xe(Tt), Xe(yt), Oa(), u.pendingContext && (u.context = u.pendingContext, u.pendingContext = null), (t === null || t.child === null) && (Fo(n) ? n.flags |= 4 : t === null || t.memoizedState.isDehydrated && (n.flags & 256) === 0 || (n.flags |= 1024, tn !== null && (hs(tn), tn = null))), rs(t, n), xt(n), null;
      case 5:
        Da(n);
        var f = mr(Ai.current);
        if (l = n.type, t !== null && n.stateNode != null) ef(t, n, l, u, f), t.ref !== n.ref && (n.flags |= 512, n.flags |= 2097152);
        else {
          if (!u) {
            if (n.stateNode === null) throw Error(i(166));
            return xt(n), null;
          }
          if (t = mr(mn.current), Fo(n)) {
            u = n.stateNode, l = n.type;
            var g = n.memoizedProps;
            switch (u[hn] = n, u[Ti] = g, t = (n.mode & 1) !== 0, l) {
              case "dialog":
                Ye("cancel", u), Ye("close", u);
                break;
              case "iframe":
              case "object":
              case "embed":
                Ye("load", u);
                break;
              case "video":
              case "audio":
                for (f = 0; f < Ci.length; f++) Ye(Ci[f], u);
                break;
              case "source":
                Ye("error", u);
                break;
              case "img":
              case "image":
              case "link":
                Ye(
                  "error",
                  u
                ), Ye("load", u);
                break;
              case "details":
                Ye("toggle", u);
                break;
              case "input":
                Ue(u, g), Ye("invalid", u);
                break;
              case "select":
                u._wrapperState = { wasMultiple: !!g.multiple }, Ye("invalid", u);
                break;
              case "textarea":
                dn(u, g), Ye("invalid", u);
            }
            Ee(l, g), f = null;
            for (var k in g) if (g.hasOwnProperty(k)) {
              var C = g[k];
              k === "children" ? typeof C == "string" ? u.textContent !== C && (g.suppressHydrationWarning !== !0 && No(u.textContent, C, t), f = ["children", C]) : typeof C == "number" && u.textContent !== "" + C && (g.suppressHydrationWarning !== !0 && No(
                u.textContent,
                C,
                t
              ), f = ["children", "" + C]) : a.hasOwnProperty(k) && C != null && k === "onScroll" && Ye("scroll", u);
            }
            switch (l) {
              case "input":
                He(u), jr(u, g, !0);
                break;
              case "textarea":
                He(u), Cn(u);
                break;
              case "select":
              case "option":
                break;
              default:
                typeof g.onClick == "function" && (u.onclick = Ao);
            }
            u = f, n.updateQueue = u, u !== null && (n.flags |= 4);
          } else {
            k = f.nodeType === 9 ? f : f.ownerDocument, t === "http://www.w3.org/1999/xhtml" && (t = H(l)), t === "http://www.w3.org/1999/xhtml" ? l === "script" ? (t = k.createElement("div"), t.innerHTML = "<script><\/script>", t = t.removeChild(t.firstChild)) : typeof u.is == "string" ? t = k.createElement(l, { is: u.is }) : (t = k.createElement(l), l === "select" && (k = t, u.multiple ? k.multiple = !0 : u.size && (k.size = u.size))) : t = k.createElementNS(t, l), t[hn] = n, t[Ti] = u, Zd(t, n, !1, !1), n.stateNode = t;
            e: {
              switch (k = it(l, u), l) {
                case "dialog":
                  Ye("cancel", t), Ye("close", t), f = u;
                  break;
                case "iframe":
                case "object":
                case "embed":
                  Ye("load", t), f = u;
                  break;
                case "video":
                case "audio":
                  for (f = 0; f < Ci.length; f++) Ye(Ci[f], t);
                  f = u;
                  break;
                case "source":
                  Ye("error", t), f = u;
                  break;
                case "img":
                case "image":
                case "link":
                  Ye(
                    "error",
                    t
                  ), Ye("load", t), f = u;
                  break;
                case "details":
                  Ye("toggle", t), f = u;
                  break;
                case "input":
                  Ue(t, u), f = Ae(t, u), Ye("invalid", t);
                  break;
                case "option":
                  f = u;
                  break;
                case "select":
                  t._wrapperState = { wasMultiple: !!u.multiple }, f = b({}, u, { value: void 0 }), Ye("invalid", t);
                  break;
                case "textarea":
                  dn(t, u), f = cn(t, u), Ye("invalid", t);
                  break;
                default:
                  f = u;
              }
              Ee(l, f), C = f;
              for (g in C) if (C.hasOwnProperty(g)) {
                var T = C[g];
                g === "style" ? ke(t, T) : g === "dangerouslySetInnerHTML" ? (T = T ? T.__html : void 0, T != null && Le(t, T)) : g === "children" ? typeof T == "string" ? (l !== "textarea" || T !== "") && De(t, T) : typeof T == "number" && De(t, "" + T) : g !== "suppressContentEditableWarning" && g !== "suppressHydrationWarning" && g !== "autoFocus" && (a.hasOwnProperty(g) ? T != null && g === "onScroll" && Ye("scroll", t) : T != null && B(t, g, T, k));
              }
              switch (l) {
                case "input":
                  He(t), jr(t, u, !1);
                  break;
                case "textarea":
                  He(t), Cn(t);
                  break;
                case "option":
                  u.value != null && t.setAttribute("value", "" + _e(u.value));
                  break;
                case "select":
                  t.multiple = !!u.multiple, g = u.value, g != null ? un(t, !!u.multiple, g, !1) : u.defaultValue != null && un(
                    t,
                    !!u.multiple,
                    u.defaultValue,
                    !0
                  );
                  break;
                default:
                  typeof f.onClick == "function" && (t.onclick = Ao);
              }
              switch (l) {
                case "button":
                case "input":
                case "select":
                case "textarea":
                  u = !!u.autoFocus;
                  break e;
                case "img":
                  u = !0;
                  break e;
                default:
                  u = !1;
              }
            }
            u && (n.flags |= 4);
          }
          n.ref !== null && (n.flags |= 512, n.flags |= 2097152);
        }
        return xt(n), null;
      case 6:
        if (t && n.stateNode != null) tf(t, n, t.memoizedProps, u);
        else {
          if (typeof u != "string" && n.stateNode === null) throw Error(i(166));
          if (l = mr(Ai.current), mr(mn.current), Fo(n)) {
            if (u = n.stateNode, l = n.memoizedProps, u[hn] = n, (g = u.nodeValue !== l) && (t = Dt, t !== null)) switch (t.tag) {
              case 3:
                No(u.nodeValue, l, (t.mode & 1) !== 0);
                break;
              case 5:
                t.memoizedProps.suppressHydrationWarning !== !0 && No(u.nodeValue, l, (t.mode & 1) !== 0);
            }
            g && (n.flags |= 4);
          } else u = (l.nodeType === 9 ? l : l.ownerDocument).createTextNode(u), u[hn] = n, n.stateNode = u;
        }
        return xt(n), null;
      case 13:
        if (Xe(Ze), u = n.memoizedState, t === null || t.memoizedState !== null && t.memoizedState.dehydrated !== null) {
          if (Je && Mt !== null && (n.mode & 1) !== 0 && (n.flags & 128) === 0) id(), Ur(), n.flags |= 98560, g = !1;
          else if (g = Fo(n), u !== null && u.dehydrated !== null) {
            if (t === null) {
              if (!g) throw Error(i(318));
              if (g = n.memoizedState, g = g !== null ? g.dehydrated : null, !g) throw Error(i(317));
              g[hn] = n;
            } else Ur(), (n.flags & 128) === 0 && (n.memoizedState = null), n.flags |= 4;
            xt(n), g = !1;
          } else tn !== null && (hs(tn), tn = null), g = !0;
          if (!g) return n.flags & 65536 ? n : null;
        }
        return (n.flags & 128) !== 0 ? (n.lanes = l, n) : (u = u !== null, u !== (t !== null && t.memoizedState !== null) && u && (n.child.flags |= 8192, (n.mode & 1) !== 0 && (t === null || (Ze.current & 1) !== 0 ? ct === 0 && (ct = 3) : ys())), n.updateQueue !== null && (n.flags |= 4), xt(n), null);
      case 4:
        return Qr(), rs(t, n), t === null && Ei(n.stateNode.containerInfo), xt(n), null;
      case 10:
        return Na(n.type._context), xt(n), null;
      case 17:
        return jt(n.type) && Po(), xt(n), null;
      case 19:
        if (Xe(Ze), g = n.memoizedState, g === null) return xt(n), null;
        if (u = (n.flags & 128) !== 0, k = g.rendering, k === null) if (u) Mi(g, !1);
        else {
          if (ct !== 0 || t !== null && (t.flags & 128) !== 0) for (t = n.child; t !== null; ) {
            if (k = Wo(t), k !== null) {
              for (n.flags |= 128, Mi(g, !1), u = k.updateQueue, u !== null && (n.updateQueue = u, n.flags |= 4), n.subtreeFlags = 0, u = l, l = n.child; l !== null; ) g = l, t = u, g.flags &= 14680066, k = g.alternate, k === null ? (g.childLanes = 0, g.lanes = t, g.child = null, g.subtreeFlags = 0, g.memoizedProps = null, g.memoizedState = null, g.updateQueue = null, g.dependencies = null, g.stateNode = null) : (g.childLanes = k.childLanes, g.lanes = k.lanes, g.child = k.child, g.subtreeFlags = 0, g.deletions = null, g.memoizedProps = k.memoizedProps, g.memoizedState = k.memoizedState, g.updateQueue = k.updateQueue, g.type = k.type, t = k.dependencies, g.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }), l = l.sibling;
              return Qe(Ze, Ze.current & 1 | 2), n.child;
            }
            t = t.sibling;
          }
          g.tail !== null && ot() > Jr && (n.flags |= 128, u = !0, Mi(g, !1), n.lanes = 4194304);
        }
        else {
          if (!u) if (t = Wo(k), t !== null) {
            if (n.flags |= 128, u = !0, l = t.updateQueue, l !== null && (n.updateQueue = l, n.flags |= 4), Mi(g, !0), g.tail === null && g.tailMode === "hidden" && !k.alternate && !Je) return xt(n), null;
          } else 2 * ot() - g.renderingStartTime > Jr && l !== 1073741824 && (n.flags |= 128, u = !0, Mi(g, !1), n.lanes = 4194304);
          g.isBackwards ? (k.sibling = n.child, n.child = k) : (l = g.last, l !== null ? l.sibling = k : n.child = k, g.last = k);
        }
        return g.tail !== null ? (n = g.tail, g.rendering = n, g.tail = n.sibling, g.renderingStartTime = ot(), n.sibling = null, l = Ze.current, Qe(Ze, u ? l & 1 | 2 : l & 1), n) : (xt(n), null);
      case 22:
      case 23:
        return gs(), u = n.memoizedState !== null, t !== null && t.memoizedState !== null !== u && (n.flags |= 8192), u && (n.mode & 1) !== 0 ? (Ot & 1073741824) !== 0 && (xt(n), n.subtreeFlags & 6 && (n.flags |= 8192)) : xt(n), null;
      case 24:
        return null;
      case 25:
        return null;
    }
    throw Error(i(156, n.tag));
  }
  function ny(t, n) {
    switch (Ea(n), n.tag) {
      case 1:
        return jt(n.type) && Po(), t = n.flags, t & 65536 ? (n.flags = t & -65537 | 128, n) : null;
      case 3:
        return Qr(), Xe(Tt), Xe(yt), Oa(), t = n.flags, (t & 65536) !== 0 && (t & 128) === 0 ? (n.flags = t & -65537 | 128, n) : null;
      case 5:
        return Da(n), null;
      case 13:
        if (Xe(Ze), t = n.memoizedState, t !== null && t.dehydrated !== null) {
          if (n.alternate === null) throw Error(i(340));
          Ur();
        }
        return t = n.flags, t & 65536 ? (n.flags = t & -65537 | 128, n) : null;
      case 19:
        return Xe(Ze), null;
      case 4:
        return Qr(), null;
      case 10:
        return Na(n.type._context), null;
      case 22:
      case 23:
        return gs(), null;
      case 24:
        return null;
      default:
        return null;
    }
  }
  var el = !1, kt = !1, ry = typeof WeakSet == "function" ? WeakSet : Set, ce = null;
  function Yr(t, n) {
    var l = t.ref;
    if (l !== null) if (typeof l == "function") try {
      l(null);
    } catch (u) {
      nt(t, n, u);
    }
    else l.current = null;
  }
  function is(t, n, l) {
    try {
      l();
    } catch (u) {
      nt(t, n, u);
    }
  }
  var nf = !1;
  function iy(t, n) {
    if (ga = ko, t = Pc(), sa(t)) {
      if ("selectionStart" in t) var l = { start: t.selectionStart, end: t.selectionEnd };
      else e: {
        l = (l = t.ownerDocument) && l.defaultView || window;
        var u = l.getSelection && l.getSelection();
        if (u && u.rangeCount !== 0) {
          l = u.anchorNode;
          var f = u.anchorOffset, g = u.focusNode;
          u = u.focusOffset;
          try {
            l.nodeType, g.nodeType;
          } catch {
            l = null;
            break e;
          }
          var k = 0, C = -1, T = -1, M = 0, G = 0, Q = t, V = null;
          t: for (; ; ) {
            for (var ae; Q !== l || f !== 0 && Q.nodeType !== 3 || (C = k + f), Q !== g || u !== 0 && Q.nodeType !== 3 || (T = k + u), Q.nodeType === 3 && (k += Q.nodeValue.length), (ae = Q.firstChild) !== null; )
              V = Q, Q = ae;
            for (; ; ) {
              if (Q === t) break t;
              if (V === l && ++M === f && (C = k), V === g && ++G === u && (T = k), (ae = Q.nextSibling) !== null) break;
              Q = V, V = Q.parentNode;
            }
            Q = ae;
          }
          l = C === -1 || T === -1 ? null : { start: C, end: T };
        } else l = null;
      }
      l = l || { start: 0, end: 0 };
    } else l = null;
    for (ya = { focusedElem: t, selectionRange: l }, ko = !1, ce = n; ce !== null; ) if (n = ce, t = n.child, (n.subtreeFlags & 1028) !== 0 && t !== null) t.return = n, ce = t;
    else for (; ce !== null; ) {
      n = ce;
      try {
        var de = n.alternate;
        if ((n.flags & 1024) !== 0) switch (n.tag) {
          case 0:
          case 11:
          case 15:
            break;
          case 1:
            if (de !== null) {
              var pe = de.memoizedProps, lt = de.memoizedState, A = n.stateNode, R = A.getSnapshotBeforeUpdate(n.elementType === n.type ? pe : nn(n.type, pe), lt);
              A.__reactInternalSnapshotBeforeUpdate = R;
            }
            break;
          case 3:
            var P = n.stateNode.containerInfo;
            P.nodeType === 1 ? P.textContent = "" : P.nodeType === 9 && P.documentElement && P.removeChild(P.documentElement);
            break;
          case 5:
          case 6:
          case 4:
          case 17:
            break;
          default:
            throw Error(i(163));
        }
      } catch (J) {
        nt(n, n.return, J);
      }
      if (t = n.sibling, t !== null) {
        t.return = n.return, ce = t;
        break;
      }
      ce = n.return;
    }
    return de = nf, nf = !1, de;
  }
  function Oi(t, n, l) {
    var u = n.updateQueue;
    if (u = u !== null ? u.lastEffect : null, u !== null) {
      var f = u = u.next;
      do {
        if ((f.tag & t) === t) {
          var g = f.destroy;
          f.destroy = void 0, g !== void 0 && is(n, l, g);
        }
        f = f.next;
      } while (f !== u);
    }
  }
  function tl(t, n) {
    if (n = n.updateQueue, n = n !== null ? n.lastEffect : null, n !== null) {
      var l = n = n.next;
      do {
        if ((l.tag & t) === t) {
          var u = l.create;
          l.destroy = u();
        }
        l = l.next;
      } while (l !== n);
    }
  }
  function os(t) {
    var n = t.ref;
    if (n !== null) {
      var l = t.stateNode;
      switch (t.tag) {
        case 5:
          t = l;
          break;
        default:
          t = l;
      }
      typeof n == "function" ? n(t) : n.current = t;
    }
  }
  function rf(t) {
    var n = t.alternate;
    n !== null && (t.alternate = null, rf(n)), t.child = null, t.deletions = null, t.sibling = null, t.tag === 5 && (n = t.stateNode, n !== null && (delete n[hn], delete n[Ti], delete n[wa], delete n[$g], delete n[Bg])), t.stateNode = null, t.return = null, t.dependencies = null, t.memoizedProps = null, t.memoizedState = null, t.pendingProps = null, t.stateNode = null, t.updateQueue = null;
  }
  function of(t) {
    return t.tag === 5 || t.tag === 3 || t.tag === 4;
  }
  function lf(t) {
    e: for (; ; ) {
      for (; t.sibling === null; ) {
        if (t.return === null || of(t.return)) return null;
        t = t.return;
      }
      for (t.sibling.return = t.return, t = t.sibling; t.tag !== 5 && t.tag !== 6 && t.tag !== 18; ) {
        if (t.flags & 2 || t.child === null || t.tag === 4) continue e;
        t.child.return = t, t = t.child;
      }
      if (!(t.flags & 2)) return t.stateNode;
    }
  }
  function ls(t, n, l) {
    var u = t.tag;
    if (u === 5 || u === 6) t = t.stateNode, n ? l.nodeType === 8 ? l.parentNode.insertBefore(t, n) : l.insertBefore(t, n) : (l.nodeType === 8 ? (n = l.parentNode, n.insertBefore(t, l)) : (n = l, n.appendChild(t)), l = l._reactRootContainer, l != null || n.onclick !== null || (n.onclick = Ao));
    else if (u !== 4 && (t = t.child, t !== null)) for (ls(t, n, l), t = t.sibling; t !== null; ) ls(t, n, l), t = t.sibling;
  }
  function as(t, n, l) {
    var u = t.tag;
    if (u === 5 || u === 6) t = t.stateNode, n ? l.insertBefore(t, n) : l.appendChild(t);
    else if (u !== 4 && (t = t.child, t !== null)) for (as(t, n, l), t = t.sibling; t !== null; ) as(t, n, l), t = t.sibling;
  }
  var mt = null, rn = !1;
  function Yn(t, n, l) {
    for (l = l.child; l !== null; ) af(t, n, l), l = l.sibling;
  }
  function af(t, n, l) {
    if (pn && typeof pn.onCommitFiberUnmount == "function") try {
      pn.onCommitFiberUnmount(ho, l);
    } catch {
    }
    switch (l.tag) {
      case 5:
        kt || Yr(l, n);
      case 6:
        var u = mt, f = rn;
        mt = null, Yn(t, n, l), mt = u, rn = f, mt !== null && (rn ? (t = mt, l = l.stateNode, t.nodeType === 8 ? t.parentNode.removeChild(l) : t.removeChild(l)) : mt.removeChild(l.stateNode));
        break;
      case 18:
        mt !== null && (rn ? (t = mt, l = l.stateNode, t.nodeType === 8 ? ka(t.parentNode, l) : t.nodeType === 1 && ka(t, l), gi(t)) : ka(mt, l.stateNode));
        break;
      case 4:
        u = mt, f = rn, mt = l.stateNode.containerInfo, rn = !0, Yn(t, n, l), mt = u, rn = f;
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        if (!kt && (u = l.updateQueue, u !== null && (u = u.lastEffect, u !== null))) {
          f = u = u.next;
          do {
            var g = f, k = g.destroy;
            g = g.tag, k !== void 0 && ((g & 2) !== 0 || (g & 4) !== 0) && is(l, n, k), f = f.next;
          } while (f !== u);
        }
        Yn(t, n, l);
        break;
      case 1:
        if (!kt && (Yr(l, n), u = l.stateNode, typeof u.componentWillUnmount == "function")) try {
          u.props = l.memoizedProps, u.state = l.memoizedState, u.componentWillUnmount();
        } catch (C) {
          nt(l, n, C);
        }
        Yn(t, n, l);
        break;
      case 21:
        Yn(t, n, l);
        break;
      case 22:
        l.mode & 1 ? (kt = (u = kt) || l.memoizedState !== null, Yn(t, n, l), kt = u) : Yn(t, n, l);
        break;
      default:
        Yn(t, n, l);
    }
  }
  function sf(t) {
    var n = t.updateQueue;
    if (n !== null) {
      t.updateQueue = null;
      var l = t.stateNode;
      l === null && (l = t.stateNode = new ry()), n.forEach(function(u) {
        var f = py.bind(null, t, u);
        l.has(u) || (l.add(u), u.then(f, f));
      });
    }
  }
  function on(t, n) {
    var l = n.deletions;
    if (l !== null) for (var u = 0; u < l.length; u++) {
      var f = l[u];
      try {
        var g = t, k = n, C = k;
        e: for (; C !== null; ) {
          switch (C.tag) {
            case 5:
              mt = C.stateNode, rn = !1;
              break e;
            case 3:
              mt = C.stateNode.containerInfo, rn = !0;
              break e;
            case 4:
              mt = C.stateNode.containerInfo, rn = !0;
              break e;
          }
          C = C.return;
        }
        if (mt === null) throw Error(i(160));
        af(g, k, f), mt = null, rn = !1;
        var T = f.alternate;
        T !== null && (T.return = null), f.return = null;
      } catch (M) {
        nt(f, n, M);
      }
    }
    if (n.subtreeFlags & 12854) for (n = n.child; n !== null; ) uf(n, t), n = n.sibling;
  }
  function uf(t, n) {
    var l = t.alternate, u = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        if (on(n, t), yn(t), u & 4) {
          try {
            Oi(3, t, t.return), tl(3, t);
          } catch (pe) {
            nt(t, t.return, pe);
          }
          try {
            Oi(5, t, t.return);
          } catch (pe) {
            nt(t, t.return, pe);
          }
        }
        break;
      case 1:
        on(n, t), yn(t), u & 512 && l !== null && Yr(l, l.return);
        break;
      case 5:
        if (on(n, t), yn(t), u & 512 && l !== null && Yr(l, l.return), t.flags & 32) {
          var f = t.stateNode;
          try {
            De(f, "");
          } catch (pe) {
            nt(t, t.return, pe);
          }
        }
        if (u & 4 && (f = t.stateNode, f != null)) {
          var g = t.memoizedProps, k = l !== null ? l.memoizedProps : g, C = t.type, T = t.updateQueue;
          if (t.updateQueue = null, T !== null) try {
            C === "input" && g.type === "radio" && g.name != null && We(f, g), it(C, k);
            var M = it(C, g);
            for (k = 0; k < T.length; k += 2) {
              var G = T[k], Q = T[k + 1];
              G === "style" ? ke(f, Q) : G === "dangerouslySetInnerHTML" ? Le(f, Q) : G === "children" ? De(f, Q) : B(f, G, Q, M);
            }
            switch (C) {
              case "input":
                Jt(f, g);
                break;
              case "textarea":
                fn(f, g);
                break;
              case "select":
                var V = f._wrapperState.wasMultiple;
                f._wrapperState.wasMultiple = !!g.multiple;
                var ae = g.value;
                ae != null ? un(f, !!g.multiple, ae, !1) : V !== !!g.multiple && (g.defaultValue != null ? un(
                  f,
                  !!g.multiple,
                  g.defaultValue,
                  !0
                ) : un(f, !!g.multiple, g.multiple ? [] : "", !1));
            }
            f[Ti] = g;
          } catch (pe) {
            nt(t, t.return, pe);
          }
        }
        break;
      case 6:
        if (on(n, t), yn(t), u & 4) {
          if (t.stateNode === null) throw Error(i(162));
          f = t.stateNode, g = t.memoizedProps;
          try {
            f.nodeValue = g;
          } catch (pe) {
            nt(t, t.return, pe);
          }
        }
        break;
      case 3:
        if (on(n, t), yn(t), u & 4 && l !== null && l.memoizedState.isDehydrated) try {
          gi(n.containerInfo);
        } catch (pe) {
          nt(t, t.return, pe);
        }
        break;
      case 4:
        on(n, t), yn(t);
        break;
      case 13:
        on(n, t), yn(t), f = t.child, f.flags & 8192 && (g = f.memoizedState !== null, f.stateNode.isHidden = g, !g || f.alternate !== null && f.alternate.memoizedState !== null || (cs = ot())), u & 4 && sf(t);
        break;
      case 22:
        if (G = l !== null && l.memoizedState !== null, t.mode & 1 ? (kt = (M = kt) || G, on(n, t), kt = M) : on(n, t), yn(t), u & 8192) {
          if (M = t.memoizedState !== null, (t.stateNode.isHidden = M) && !G && (t.mode & 1) !== 0) for (ce = t, G = t.child; G !== null; ) {
            for (Q = ce = G; ce !== null; ) {
              switch (V = ce, ae = V.child, V.tag) {
                case 0:
                case 11:
                case 14:
                case 15:
                  Oi(4, V, V.return);
                  break;
                case 1:
                  Yr(V, V.return);
                  var de = V.stateNode;
                  if (typeof de.componentWillUnmount == "function") {
                    u = V, l = V.return;
                    try {
                      n = u, de.props = n.memoizedProps, de.state = n.memoizedState, de.componentWillUnmount();
                    } catch (pe) {
                      nt(u, l, pe);
                    }
                  }
                  break;
                case 5:
                  Yr(V, V.return);
                  break;
                case 22:
                  if (V.memoizedState !== null) {
                    ff(Q);
                    continue;
                  }
              }
              ae !== null ? (ae.return = V, ce = ae) : ff(Q);
            }
            G = G.sibling;
          }
          e: for (G = null, Q = t; ; ) {
            if (Q.tag === 5) {
              if (G === null) {
                G = Q;
                try {
                  f = Q.stateNode, M ? (g = f.style, typeof g.setProperty == "function" ? g.setProperty("display", "none", "important") : g.display = "none") : (C = Q.stateNode, T = Q.memoizedProps.style, k = T != null && T.hasOwnProperty("display") ? T.display : null, C.style.display = St("display", k));
                } catch (pe) {
                  nt(t, t.return, pe);
                }
              }
            } else if (Q.tag === 6) {
              if (G === null) try {
                Q.stateNode.nodeValue = M ? "" : Q.memoizedProps;
              } catch (pe) {
                nt(t, t.return, pe);
              }
            } else if ((Q.tag !== 22 && Q.tag !== 23 || Q.memoizedState === null || Q === t) && Q.child !== null) {
              Q.child.return = Q, Q = Q.child;
              continue;
            }
            if (Q === t) break e;
            for (; Q.sibling === null; ) {
              if (Q.return === null || Q.return === t) break e;
              G === Q && (G = null), Q = Q.return;
            }
            G === Q && (G = null), Q.sibling.return = Q.return, Q = Q.sibling;
          }
        }
        break;
      case 19:
        on(n, t), yn(t), u & 4 && sf(t);
        break;
      case 21:
        break;
      default:
        on(
          n,
          t
        ), yn(t);
    }
  }
  function yn(t) {
    var n = t.flags;
    if (n & 2) {
      try {
        e: {
          for (var l = t.return; l !== null; ) {
            if (of(l)) {
              var u = l;
              break e;
            }
            l = l.return;
          }
          throw Error(i(160));
        }
        switch (u.tag) {
          case 5:
            var f = u.stateNode;
            u.flags & 32 && (De(f, ""), u.flags &= -33);
            var g = lf(t);
            as(t, g, f);
            break;
          case 3:
          case 4:
            var k = u.stateNode.containerInfo, C = lf(t);
            ls(t, C, k);
            break;
          default:
            throw Error(i(161));
        }
      } catch (T) {
        nt(t, t.return, T);
      }
      t.flags &= -3;
    }
    n & 4096 && (t.flags &= -4097);
  }
  function oy(t, n, l) {
    ce = t, cf(t);
  }
  function cf(t, n, l) {
    for (var u = (t.mode & 1) !== 0; ce !== null; ) {
      var f = ce, g = f.child;
      if (f.tag === 22 && u) {
        var k = f.memoizedState !== null || el;
        if (!k) {
          var C = f.alternate, T = C !== null && C.memoizedState !== null || kt;
          C = el;
          var M = kt;
          if (el = k, (kt = T) && !M) for (ce = f; ce !== null; ) k = ce, T = k.child, k.tag === 22 && k.memoizedState !== null ? pf(f) : T !== null ? (T.return = k, ce = T) : pf(f);
          for (; g !== null; ) ce = g, cf(g), g = g.sibling;
          ce = f, el = C, kt = M;
        }
        df(t);
      } else (f.subtreeFlags & 8772) !== 0 && g !== null ? (g.return = f, ce = g) : df(t);
    }
  }
  function df(t) {
    for (; ce !== null; ) {
      var n = ce;
      if ((n.flags & 8772) !== 0) {
        var l = n.alternate;
        try {
          if ((n.flags & 8772) !== 0) switch (n.tag) {
            case 0:
            case 11:
            case 15:
              kt || tl(5, n);
              break;
            case 1:
              var u = n.stateNode;
              if (n.flags & 4 && !kt) if (l === null) u.componentDidMount();
              else {
                var f = n.elementType === n.type ? l.memoizedProps : nn(n.type, l.memoizedProps);
                u.componentDidUpdate(f, l.memoizedState, u.__reactInternalSnapshotBeforeUpdate);
              }
              var g = n.updateQueue;
              g !== null && dd(n, g, u);
              break;
            case 3:
              var k = n.updateQueue;
              if (k !== null) {
                if (l = null, n.child !== null) switch (n.child.tag) {
                  case 5:
                    l = n.child.stateNode;
                    break;
                  case 1:
                    l = n.child.stateNode;
                }
                dd(n, k, l);
              }
              break;
            case 5:
              var C = n.stateNode;
              if (l === null && n.flags & 4) {
                l = C;
                var T = n.memoizedProps;
                switch (n.type) {
                  case "button":
                  case "input":
                  case "select":
                  case "textarea":
                    T.autoFocus && l.focus();
                    break;
                  case "img":
                    T.src && (l.src = T.src);
                }
              }
              break;
            case 6:
              break;
            case 4:
              break;
            case 12:
              break;
            case 13:
              if (n.memoizedState === null) {
                var M = n.alternate;
                if (M !== null) {
                  var G = M.memoizedState;
                  if (G !== null) {
                    var Q = G.dehydrated;
                    Q !== null && gi(Q);
                  }
                }
              }
              break;
            case 19:
            case 17:
            case 21:
            case 22:
            case 23:
            case 25:
              break;
            default:
              throw Error(i(163));
          }
          kt || n.flags & 512 && os(n);
        } catch (V) {
          nt(n, n.return, V);
        }
      }
      if (n === t) {
        ce = null;
        break;
      }
      if (l = n.sibling, l !== null) {
        l.return = n.return, ce = l;
        break;
      }
      ce = n.return;
    }
  }
  function ff(t) {
    for (; ce !== null; ) {
      var n = ce;
      if (n === t) {
        ce = null;
        break;
      }
      var l = n.sibling;
      if (l !== null) {
        l.return = n.return, ce = l;
        break;
      }
      ce = n.return;
    }
  }
  function pf(t) {
    for (; ce !== null; ) {
      var n = ce;
      try {
        switch (n.tag) {
          case 0:
          case 11:
          case 15:
            var l = n.return;
            try {
              tl(4, n);
            } catch (T) {
              nt(n, l, T);
            }
            break;
          case 1:
            var u = n.stateNode;
            if (typeof u.componentDidMount == "function") {
              var f = n.return;
              try {
                u.componentDidMount();
              } catch (T) {
                nt(n, f, T);
              }
            }
            var g = n.return;
            try {
              os(n);
            } catch (T) {
              nt(n, g, T);
            }
            break;
          case 5:
            var k = n.return;
            try {
              os(n);
            } catch (T) {
              nt(n, k, T);
            }
        }
      } catch (T) {
        nt(n, n.return, T);
      }
      if (n === t) {
        ce = null;
        break;
      }
      var C = n.sibling;
      if (C !== null) {
        C.return = n.return, ce = C;
        break;
      }
      ce = n.return;
    }
  }
  var ly = Math.ceil, nl = ne.ReactCurrentDispatcher, ss = ne.ReactCurrentOwner, Vt = ne.ReactCurrentBatchConfig, Fe = 0, pt = null, at = null, gt = 0, Ot = 0, Xr = Wn(0), ct = 0, Fi = null, yr = 0, rl = 0, us = 0, $i = null, Lt = null, cs = 0, Jr = 1 / 0, An = null, il = !1, ds = null, Xn = null, ol = !1, Jn = null, ll = 0, Bi = 0, fs = null, al = -1, sl = 0;
  function Et() {
    return (Fe & 6) !== 0 ? ot() : al !== -1 ? al : al = ot();
  }
  function Zn(t) {
    return (t.mode & 1) === 0 ? 1 : (Fe & 2) !== 0 && gt !== 0 ? gt & -gt : qg.transition !== null ? (sl === 0 && (sl = oc()), sl) : (t = qe, t !== 0 || (t = window.event, t = t === void 0 ? 16 : hc(t.type)), t);
  }
  function ln(t, n, l, u) {
    if (50 < Bi) throw Bi = 0, fs = null, Error(i(185));
    di(t, l, u), ((Fe & 2) === 0 || t !== pt) && (t === pt && ((Fe & 2) === 0 && (rl |= l), ct === 4 && er(t, gt)), Nt(t, u), l === 1 && Fe === 0 && (n.mode & 1) === 0 && (Jr = ot() + 500, Do && Gn()));
  }
  function Nt(t, n) {
    var l = t.callbackNode;
    qm(t, n);
    var u = yo(t, t === pt ? gt : 0);
    if (u === 0) l !== null && nc(l), t.callbackNode = null, t.callbackPriority = 0;
    else if (n = u & -u, t.callbackPriority !== n) {
      if (l != null && nc(l), n === 1) t.tag === 0 ? Hg(mf.bind(null, t)) : Zc(mf.bind(null, t)), Og(function() {
        (Fe & 6) === 0 && Gn();
      }), l = null;
      else {
        switch (lc(u)) {
          case 1:
            l = Wl;
            break;
          case 4:
            l = rc;
            break;
          case 16:
            l = po;
            break;
          case 536870912:
            l = ic;
            break;
          default:
            l = po;
        }
        l = Sf(l, hf.bind(null, t));
      }
      t.callbackPriority = n, t.callbackNode = l;
    }
  }
  function hf(t, n) {
    if (al = -1, sl = 0, (Fe & 6) !== 0) throw Error(i(327));
    var l = t.callbackNode;
    if (Zr() && t.callbackNode !== l) return null;
    var u = yo(t, t === pt ? gt : 0);
    if (u === 0) return null;
    if ((u & 30) !== 0 || (u & t.expiredLanes) !== 0 || n) n = ul(t, u);
    else {
      n = u;
      var f = Fe;
      Fe |= 2;
      var g = yf();
      (pt !== t || gt !== n) && (An = null, Jr = ot() + 500, xr(t, n));
      do
        try {
          uy();
          break;
        } catch (C) {
          gf(t, C);
        }
      while (!0);
      La(), nl.current = g, Fe = f, at !== null ? n = 0 : (pt = null, gt = 0, n = ct);
    }
    if (n !== 0) {
      if (n === 2 && (f = Vl(t), f !== 0 && (u = f, n = ps(t, f))), n === 1) throw l = Fi, xr(t, 0), er(t, u), Nt(t, ot()), l;
      if (n === 6) er(t, u);
      else {
        if (f = t.current.alternate, (u & 30) === 0 && !ay(f) && (n = ul(t, u), n === 2 && (g = Vl(t), g !== 0 && (u = g, n = ps(t, g))), n === 1)) throw l = Fi, xr(t, 0), er(t, u), Nt(t, ot()), l;
        switch (t.finishedWork = f, t.finishedLanes = u, n) {
          case 0:
          case 1:
            throw Error(i(345));
          case 2:
            kr(t, Lt, An);
            break;
          case 3:
            if (er(t, u), (u & 130023424) === u && (n = cs + 500 - ot(), 10 < n)) {
              if (yo(t, 0) !== 0) break;
              if (f = t.suspendedLanes, (f & u) !== u) {
                Et(), t.pingedLanes |= t.suspendedLanes & f;
                break;
              }
              t.timeoutHandle = xa(kr.bind(null, t, Lt, An), n);
              break;
            }
            kr(t, Lt, An);
            break;
          case 4:
            if (er(t, u), (u & 4194240) === u) break;
            for (n = t.eventTimes, f = -1; 0 < u; ) {
              var k = 31 - Zt(u);
              g = 1 << k, k = n[k], k > f && (f = k), u &= ~g;
            }
            if (u = f, u = ot() - u, u = (120 > u ? 120 : 480 > u ? 480 : 1080 > u ? 1080 : 1920 > u ? 1920 : 3e3 > u ? 3e3 : 4320 > u ? 4320 : 1960 * ly(u / 1960)) - u, 10 < u) {
              t.timeoutHandle = xa(kr.bind(null, t, Lt, An), u);
              break;
            }
            kr(t, Lt, An);
            break;
          case 5:
            kr(t, Lt, An);
            break;
          default:
            throw Error(i(329));
        }
      }
    }
    return Nt(t, ot()), t.callbackNode === l ? hf.bind(null, t) : null;
  }
  function ps(t, n) {
    var l = $i;
    return t.current.memoizedState.isDehydrated && (xr(t, n).flags |= 256), t = ul(t, n), t !== 2 && (n = Lt, Lt = l, n !== null && hs(n)), t;
  }
  function hs(t) {
    Lt === null ? Lt = t : Lt.push.apply(Lt, t);
  }
  function ay(t) {
    for (var n = t; ; ) {
      if (n.flags & 16384) {
        var l = n.updateQueue;
        if (l !== null && (l = l.stores, l !== null)) for (var u = 0; u < l.length; u++) {
          var f = l[u], g = f.getSnapshot;
          f = f.value;
          try {
            if (!en(g(), f)) return !1;
          } catch {
            return !1;
          }
        }
      }
      if (l = n.child, n.subtreeFlags & 16384 && l !== null) l.return = n, n = l;
      else {
        if (n === t) break;
        for (; n.sibling === null; ) {
          if (n.return === null || n.return === t) return !0;
          n = n.return;
        }
        n.sibling.return = n.return, n = n.sibling;
      }
    }
    return !0;
  }
  function er(t, n) {
    for (n &= ~us, n &= ~rl, t.suspendedLanes |= n, t.pingedLanes &= ~n, t = t.expirationTimes; 0 < n; ) {
      var l = 31 - Zt(n), u = 1 << l;
      t[l] = -1, n &= ~u;
    }
  }
  function mf(t) {
    if ((Fe & 6) !== 0) throw Error(i(327));
    Zr();
    var n = yo(t, 0);
    if ((n & 1) === 0) return Nt(t, ot()), null;
    var l = ul(t, n);
    if (t.tag !== 0 && l === 2) {
      var u = Vl(t);
      u !== 0 && (n = u, l = ps(t, u));
    }
    if (l === 1) throw l = Fi, xr(t, 0), er(t, n), Nt(t, ot()), l;
    if (l === 6) throw Error(i(345));
    return t.finishedWork = t.current.alternate, t.finishedLanes = n, kr(t, Lt, An), Nt(t, ot()), null;
  }
  function ms(t, n) {
    var l = Fe;
    Fe |= 1;
    try {
      return t(n);
    } finally {
      Fe = l, Fe === 0 && (Jr = ot() + 500, Do && Gn());
    }
  }
  function vr(t) {
    Jn !== null && Jn.tag === 0 && (Fe & 6) === 0 && Zr();
    var n = Fe;
    Fe |= 1;
    var l = Vt.transition, u = qe;
    try {
      if (Vt.transition = null, qe = 1, t) return t();
    } finally {
      qe = u, Vt.transition = l, Fe = n, (Fe & 6) === 0 && Gn();
    }
  }
  function gs() {
    Ot = Xr.current, Xe(Xr);
  }
  function xr(t, n) {
    t.finishedWork = null, t.finishedLanes = 0;
    var l = t.timeoutHandle;
    if (l !== -1 && (t.timeoutHandle = -1, Mg(l)), at !== null) for (l = at.return; l !== null; ) {
      var u = l;
      switch (Ea(u), u.tag) {
        case 1:
          u = u.type.childContextTypes, u != null && Po();
          break;
        case 3:
          Qr(), Xe(Tt), Xe(yt), Oa();
          break;
        case 5:
          Da(u);
          break;
        case 4:
          Qr();
          break;
        case 13:
          Xe(Ze);
          break;
        case 19:
          Xe(Ze);
          break;
        case 10:
          Na(u.type._context);
          break;
        case 22:
        case 23:
          gs();
      }
      l = l.return;
    }
    if (pt = t, at = t = tr(t.current, null), gt = Ot = n, ct = 0, Fi = null, us = rl = yr = 0, Lt = $i = null, hr !== null) {
      for (n = 0; n < hr.length; n++) if (l = hr[n], u = l.interleaved, u !== null) {
        l.interleaved = null;
        var f = u.next, g = l.pending;
        if (g !== null) {
          var k = g.next;
          g.next = f, u.next = k;
        }
        l.pending = u;
      }
      hr = null;
    }
    return t;
  }
  function gf(t, n) {
    do {
      var l = at;
      try {
        if (La(), Vo.current = Yo, Go) {
          for (var u = et.memoizedState; u !== null; ) {
            var f = u.queue;
            f !== null && (f.pending = null), u = u.next;
          }
          Go = !1;
        }
        if (gr = 0, ft = ut = et = null, zi = !1, Pi = 0, ss.current = null, l === null || l.return === null) {
          ct = 1, Fi = n, at = null;
          break;
        }
        e: {
          var g = t, k = l.return, C = l, T = n;
          if (n = gt, C.flags |= 32768, T !== null && typeof T == "object" && typeof T.then == "function") {
            var M = T, G = C, Q = G.tag;
            if ((G.mode & 1) === 0 && (Q === 0 || Q === 11 || Q === 15)) {
              var V = G.alternate;
              V ? (G.updateQueue = V.updateQueue, G.memoizedState = V.memoizedState, G.lanes = V.lanes) : (G.updateQueue = null, G.memoizedState = null);
            }
            var ae = $d(k);
            if (ae !== null) {
              ae.flags &= -257, Bd(ae, k, C, g, n), ae.mode & 1 && Fd(g, M, n), n = ae, T = M;
              var de = n.updateQueue;
              if (de === null) {
                var pe = /* @__PURE__ */ new Set();
                pe.add(T), n.updateQueue = pe;
              } else de.add(T);
              break e;
            } else {
              if ((n & 1) === 0) {
                Fd(g, M, n), ys();
                break e;
              }
              T = Error(i(426));
            }
          } else if (Je && C.mode & 1) {
            var lt = $d(k);
            if (lt !== null) {
              (lt.flags & 65536) === 0 && (lt.flags |= 256), Bd(lt, k, C, g, n), ja(Kr(T, C));
              break e;
            }
          }
          g = T = Kr(T, C), ct !== 4 && (ct = 2), $i === null ? $i = [g] : $i.push(g), g = k;
          do {
            switch (g.tag) {
              case 3:
                g.flags |= 65536, n &= -n, g.lanes |= n;
                var A = Md(g, T, n);
                cd(g, A);
                break e;
              case 1:
                C = T;
                var R = g.type, P = g.stateNode;
                if ((g.flags & 128) === 0 && (typeof R.getDerivedStateFromError == "function" || P !== null && typeof P.componentDidCatch == "function" && (Xn === null || !Xn.has(P)))) {
                  g.flags |= 65536, n &= -n, g.lanes |= n;
                  var J = Od(g, C, n);
                  cd(g, J);
                  break e;
                }
            }
            g = g.return;
          } while (g !== null);
        }
        xf(l);
      } catch (me) {
        n = me, at === l && l !== null && (at = l = l.return);
        continue;
      }
      break;
    } while (!0);
  }
  function yf() {
    var t = nl.current;
    return nl.current = Yo, t === null ? Yo : t;
  }
  function ys() {
    (ct === 0 || ct === 3 || ct === 2) && (ct = 4), pt === null || (yr & 268435455) === 0 && (rl & 268435455) === 0 || er(pt, gt);
  }
  function ul(t, n) {
    var l = Fe;
    Fe |= 2;
    var u = yf();
    (pt !== t || gt !== n) && (An = null, xr(t, n));
    do
      try {
        sy();
        break;
      } catch (f) {
        gf(t, f);
      }
    while (!0);
    if (La(), Fe = l, nl.current = u, at !== null) throw Error(i(261));
    return pt = null, gt = 0, ct;
  }
  function sy() {
    for (; at !== null; ) vf(at);
  }
  function uy() {
    for (; at !== null && !Pm(); ) vf(at);
  }
  function vf(t) {
    var n = bf(t.alternate, t, Ot);
    t.memoizedProps = t.pendingProps, n === null ? xf(t) : at = n, ss.current = null;
  }
  function xf(t) {
    var n = t;
    do {
      var l = n.alternate;
      if (t = n.return, (n.flags & 32768) === 0) {
        if (l = ty(l, n, Ot), l !== null) {
          at = l;
          return;
        }
      } else {
        if (l = ny(l, n), l !== null) {
          l.flags &= 32767, at = l;
          return;
        }
        if (t !== null) t.flags |= 32768, t.subtreeFlags = 0, t.deletions = null;
        else {
          ct = 6, at = null;
          return;
        }
      }
      if (n = n.sibling, n !== null) {
        at = n;
        return;
      }
      at = n = t;
    } while (n !== null);
    ct === 0 && (ct = 5);
  }
  function kr(t, n, l) {
    var u = qe, f = Vt.transition;
    try {
      Vt.transition = null, qe = 1, cy(t, n, l, u);
    } finally {
      Vt.transition = f, qe = u;
    }
    return null;
  }
  function cy(t, n, l, u) {
    do
      Zr();
    while (Jn !== null);
    if ((Fe & 6) !== 0) throw Error(i(327));
    l = t.finishedWork;
    var f = t.finishedLanes;
    if (l === null) return null;
    if (t.finishedWork = null, t.finishedLanes = 0, l === t.current) throw Error(i(177));
    t.callbackNode = null, t.callbackPriority = 0;
    var g = l.lanes | l.childLanes;
    if (Um(t, g), t === pt && (at = pt = null, gt = 0), (l.subtreeFlags & 2064) === 0 && (l.flags & 2064) === 0 || ol || (ol = !0, Sf(po, function() {
      return Zr(), null;
    })), g = (l.flags & 15990) !== 0, (l.subtreeFlags & 15990) !== 0 || g) {
      g = Vt.transition, Vt.transition = null;
      var k = qe;
      qe = 1;
      var C = Fe;
      Fe |= 4, ss.current = null, iy(t, l), uf(l, t), Lg(ya), ko = !!ga, ya = ga = null, t.current = l, oy(l), Im(), Fe = C, qe = k, Vt.transition = g;
    } else t.current = l;
    if (ol && (ol = !1, Jn = t, ll = f), g = t.pendingLanes, g === 0 && (Xn = null), Om(l.stateNode), Nt(t, ot()), n !== null) for (u = t.onRecoverableError, l = 0; l < n.length; l++) f = n[l], u(f.value, { componentStack: f.stack, digest: f.digest });
    if (il) throw il = !1, t = ds, ds = null, t;
    return (ll & 1) !== 0 && t.tag !== 0 && Zr(), g = t.pendingLanes, (g & 1) !== 0 ? t === fs ? Bi++ : (Bi = 0, fs = t) : Bi = 0, Gn(), null;
  }
  function Zr() {
    if (Jn !== null) {
      var t = lc(ll), n = Vt.transition, l = qe;
      try {
        if (Vt.transition = null, qe = 16 > t ? 16 : t, Jn === null) var u = !1;
        else {
          if (t = Jn, Jn = null, ll = 0, (Fe & 6) !== 0) throw Error(i(331));
          var f = Fe;
          for (Fe |= 4, ce = t.current; ce !== null; ) {
            var g = ce, k = g.child;
            if ((ce.flags & 16) !== 0) {
              var C = g.deletions;
              if (C !== null) {
                for (var T = 0; T < C.length; T++) {
                  var M = C[T];
                  for (ce = M; ce !== null; ) {
                    var G = ce;
                    switch (G.tag) {
                      case 0:
                      case 11:
                      case 15:
                        Oi(8, G, g);
                    }
                    var Q = G.child;
                    if (Q !== null) Q.return = G, ce = Q;
                    else for (; ce !== null; ) {
                      G = ce;
                      var V = G.sibling, ae = G.return;
                      if (rf(G), G === M) {
                        ce = null;
                        break;
                      }
                      if (V !== null) {
                        V.return = ae, ce = V;
                        break;
                      }
                      ce = ae;
                    }
                  }
                }
                var de = g.alternate;
                if (de !== null) {
                  var pe = de.child;
                  if (pe !== null) {
                    de.child = null;
                    do {
                      var lt = pe.sibling;
                      pe.sibling = null, pe = lt;
                    } while (pe !== null);
                  }
                }
                ce = g;
              }
            }
            if ((g.subtreeFlags & 2064) !== 0 && k !== null) k.return = g, ce = k;
            else e: for (; ce !== null; ) {
              if (g = ce, (g.flags & 2048) !== 0) switch (g.tag) {
                case 0:
                case 11:
                case 15:
                  Oi(9, g, g.return);
              }
              var A = g.sibling;
              if (A !== null) {
                A.return = g.return, ce = A;
                break e;
              }
              ce = g.return;
            }
          }
          var R = t.current;
          for (ce = R; ce !== null; ) {
            k = ce;
            var P = k.child;
            if ((k.subtreeFlags & 2064) !== 0 && P !== null) P.return = k, ce = P;
            else e: for (k = R; ce !== null; ) {
              if (C = ce, (C.flags & 2048) !== 0) try {
                switch (C.tag) {
                  case 0:
                  case 11:
                  case 15:
                    tl(9, C);
                }
              } catch (me) {
                nt(C, C.return, me);
              }
              if (C === k) {
                ce = null;
                break e;
              }
              var J = C.sibling;
              if (J !== null) {
                J.return = C.return, ce = J;
                break e;
              }
              ce = C.return;
            }
          }
          if (Fe = f, Gn(), pn && typeof pn.onPostCommitFiberRoot == "function") try {
            pn.onPostCommitFiberRoot(ho, t);
          } catch {
          }
          u = !0;
        }
        return u;
      } finally {
        qe = l, Vt.transition = n;
      }
    }
    return !1;
  }
  function kf(t, n, l) {
    n = Kr(l, n), n = Md(t, n, 1), t = Kn(t, n, 1), n = Et(), t !== null && (di(t, 1, n), Nt(t, n));
  }
  function nt(t, n, l) {
    if (t.tag === 3) kf(t, t, l);
    else for (; n !== null; ) {
      if (n.tag === 3) {
        kf(n, t, l);
        break;
      } else if (n.tag === 1) {
        var u = n.stateNode;
        if (typeof n.type.getDerivedStateFromError == "function" || typeof u.componentDidCatch == "function" && (Xn === null || !Xn.has(u))) {
          t = Kr(l, t), t = Od(n, t, 1), n = Kn(n, t, 1), t = Et(), n !== null && (di(n, 1, t), Nt(n, t));
          break;
        }
      }
      n = n.return;
    }
  }
  function dy(t, n, l) {
    var u = t.pingCache;
    u !== null && u.delete(n), n = Et(), t.pingedLanes |= t.suspendedLanes & l, pt === t && (gt & l) === l && (ct === 4 || ct === 3 && (gt & 130023424) === gt && 500 > ot() - cs ? xr(t, 0) : us |= l), Nt(t, n);
  }
  function wf(t, n) {
    n === 0 && ((t.mode & 1) === 0 ? n = 1 : (n = go, go <<= 1, (go & 130023424) === 0 && (go = 4194304)));
    var l = Et();
    t = Rn(t, n), t !== null && (di(t, n, l), Nt(t, l));
  }
  function fy(t) {
    var n = t.memoizedState, l = 0;
    n !== null && (l = n.retryLane), wf(t, l);
  }
  function py(t, n) {
    var l = 0;
    switch (t.tag) {
      case 13:
        var u = t.stateNode, f = t.memoizedState;
        f !== null && (l = f.retryLane);
        break;
      case 19:
        u = t.stateNode;
        break;
      default:
        throw Error(i(314));
    }
    u !== null && u.delete(n), wf(t, l);
  }
  var bf;
  bf = function(t, n, l) {
    if (t !== null) if (t.memoizedProps !== n.pendingProps || Tt.current) Rt = !0;
    else {
      if ((t.lanes & l) === 0 && (n.flags & 128) === 0) return Rt = !1, ey(t, n, l);
      Rt = (t.flags & 131072) !== 0;
    }
    else Rt = !1, Je && (n.flags & 1048576) !== 0 && ed(n, Oo, n.index);
    switch (n.lanes = 0, n.tag) {
      case 2:
        var u = n.type;
        Zo(t, n), t = n.pendingProps;
        var f = Br(n, yt.current);
        Gr(n, l), f = Ba(null, n, u, t, f, l);
        var g = Ha();
        return n.flags |= 1, typeof f == "object" && f !== null && typeof f.render == "function" && f.$$typeof === void 0 ? (n.tag = 1, n.memoizedState = null, n.updateQueue = null, jt(u) ? (g = !0, Io(n)) : g = !1, n.memoizedState = f.state !== null && f.state !== void 0 ? f.state : null, Pa(n), f.updater = Xo, n.stateNode = f, f._reactInternals = n, Qa(n, u, t, l), n = Ja(null, n, u, !0, g, l)) : (n.tag = 0, Je && g && Ca(n), Ct(null, n, f, l), n = n.child), n;
      case 16:
        u = n.elementType;
        e: {
          switch (Zo(t, n), t = n.pendingProps, f = u._init, u = f(u._payload), n.type = u, f = n.tag = my(u), t = nn(u, t), f) {
            case 0:
              n = Xa(null, n, u, t, l);
              break e;
            case 1:
              n = Gd(null, n, u, t, l);
              break e;
            case 11:
              n = Hd(null, n, u, t, l);
              break e;
            case 14:
              n = qd(null, n, u, nn(u.type, t), l);
              break e;
          }
          throw Error(i(
            306,
            u,
            ""
          ));
        }
        return n;
      case 0:
        return u = n.type, f = n.pendingProps, f = n.elementType === u ? f : nn(u, f), Xa(t, n, u, f, l);
      case 1:
        return u = n.type, f = n.pendingProps, f = n.elementType === u ? f : nn(u, f), Gd(t, n, u, f, l);
      case 3:
        e: {
          if (Qd(n), t === null) throw Error(i(387));
          u = n.pendingProps, g = n.memoizedState, f = g.element, ud(t, n), Uo(n, u, null, l);
          var k = n.memoizedState;
          if (u = k.element, g.isDehydrated) if (g = { element: u, isDehydrated: !1, cache: k.cache, pendingSuspenseBoundaries: k.pendingSuspenseBoundaries, transitions: k.transitions }, n.updateQueue.baseState = g, n.memoizedState = g, n.flags & 256) {
            f = Kr(Error(i(423)), n), n = Kd(t, n, u, l, f);
            break e;
          } else if (u !== f) {
            f = Kr(Error(i(424)), n), n = Kd(t, n, u, l, f);
            break e;
          } else for (Mt = Un(n.stateNode.containerInfo.firstChild), Dt = n, Je = !0, tn = null, l = ad(n, null, u, l), n.child = l; l; ) l.flags = l.flags & -3 | 4096, l = l.sibling;
          else {
            if (Ur(), u === f) {
              n = Nn(t, n, l);
              break e;
            }
            Ct(t, n, u, l);
          }
          n = n.child;
        }
        return n;
      case 5:
        return fd(n), t === null && Ta(n), u = n.type, f = n.pendingProps, g = t !== null ? t.memoizedProps : null, k = f.children, va(u, f) ? k = null : g !== null && va(u, g) && (n.flags |= 32), Vd(t, n), Ct(t, n, k, l), n.child;
      case 6:
        return t === null && Ta(n), null;
      case 13:
        return Yd(t, n, l);
      case 4:
        return Ia(n, n.stateNode.containerInfo), u = n.pendingProps, t === null ? n.child = Wr(n, null, u, l) : Ct(t, n, u, l), n.child;
      case 11:
        return u = n.type, f = n.pendingProps, f = n.elementType === u ? f : nn(u, f), Hd(t, n, u, f, l);
      case 7:
        return Ct(t, n, n.pendingProps, l), n.child;
      case 8:
        return Ct(t, n, n.pendingProps.children, l), n.child;
      case 12:
        return Ct(t, n, n.pendingProps.children, l), n.child;
      case 10:
        e: {
          if (u = n.type._context, f = n.pendingProps, g = n.memoizedProps, k = f.value, Qe(Bo, u._currentValue), u._currentValue = k, g !== null) if (en(g.value, k)) {
            if (g.children === f.children && !Tt.current) {
              n = Nn(t, n, l);
              break e;
            }
          } else for (g = n.child, g !== null && (g.return = n); g !== null; ) {
            var C = g.dependencies;
            if (C !== null) {
              k = g.child;
              for (var T = C.firstContext; T !== null; ) {
                if (T.context === u) {
                  if (g.tag === 1) {
                    T = Ln(-1, l & -l), T.tag = 2;
                    var M = g.updateQueue;
                    if (M !== null) {
                      M = M.shared;
                      var G = M.pending;
                      G === null ? T.next = T : (T.next = G.next, G.next = T), M.pending = T;
                    }
                  }
                  g.lanes |= l, T = g.alternate, T !== null && (T.lanes |= l), Aa(
                    g.return,
                    l,
                    n
                  ), C.lanes |= l;
                  break;
                }
                T = T.next;
              }
            } else if (g.tag === 10) k = g.type === n.type ? null : g.child;
            else if (g.tag === 18) {
              if (k = g.return, k === null) throw Error(i(341));
              k.lanes |= l, C = k.alternate, C !== null && (C.lanes |= l), Aa(k, l, n), k = g.sibling;
            } else k = g.child;
            if (k !== null) k.return = g;
            else for (k = g; k !== null; ) {
              if (k === n) {
                k = null;
                break;
              }
              if (g = k.sibling, g !== null) {
                g.return = k.return, k = g;
                break;
              }
              k = k.return;
            }
            g = k;
          }
          Ct(t, n, f.children, l), n = n.child;
        }
        return n;
      case 9:
        return f = n.type, u = n.pendingProps.children, Gr(n, l), f = Ut(f), u = u(f), n.flags |= 1, Ct(t, n, u, l), n.child;
      case 14:
        return u = n.type, f = nn(u, n.pendingProps), f = nn(u.type, f), qd(t, n, u, f, l);
      case 15:
        return Ud(t, n, n.type, n.pendingProps, l);
      case 17:
        return u = n.type, f = n.pendingProps, f = n.elementType === u ? f : nn(u, f), Zo(t, n), n.tag = 1, jt(u) ? (t = !0, Io(n)) : t = !1, Gr(n, l), Id(n, u, f), Qa(n, u, f, l), Ja(null, n, u, !0, t, l);
      case 19:
        return Jd(t, n, l);
      case 22:
        return Wd(t, n, l);
    }
    throw Error(i(156, n.tag));
  };
  function Sf(t, n) {
    return tc(t, n);
  }
  function hy(t, n, l, u) {
    this.tag = t, this.key = l, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.ref = null, this.pendingProps = n, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = u, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
  }
  function Gt(t, n, l, u) {
    return new hy(t, n, l, u);
  }
  function vs(t) {
    return t = t.prototype, !(!t || !t.isReactComponent);
  }
  function my(t) {
    if (typeof t == "function") return vs(t) ? 1 : 0;
    if (t != null) {
      if (t = t.$$typeof, t === ie) return 11;
      if (t === X) return 14;
    }
    return 2;
  }
  function tr(t, n) {
    var l = t.alternate;
    return l === null ? (l = Gt(t.tag, n, t.key, t.mode), l.elementType = t.elementType, l.type = t.type, l.stateNode = t.stateNode, l.alternate = t, t.alternate = l) : (l.pendingProps = n, l.type = t.type, l.flags = 0, l.subtreeFlags = 0, l.deletions = null), l.flags = t.flags & 14680064, l.childLanes = t.childLanes, l.lanes = t.lanes, l.child = t.child, l.memoizedProps = t.memoizedProps, l.memoizedState = t.memoizedState, l.updateQueue = t.updateQueue, n = t.dependencies, l.dependencies = n === null ? null : { lanes: n.lanes, firstContext: n.firstContext }, l.sibling = t.sibling, l.index = t.index, l.ref = t.ref, l;
  }
  function cl(t, n, l, u, f, g) {
    var k = 2;
    if (u = t, typeof t == "function") vs(t) && (k = 1);
    else if (typeof t == "string") k = 5;
    else e: switch (t) {
      case Y:
        return wr(l.children, f, g, n);
      case se:
        k = 8, f |= 8;
        break;
      case re:
        return t = Gt(12, l, n, f | 2), t.elementType = re, t.lanes = g, t;
      case xe:
        return t = Gt(13, l, n, f), t.elementType = xe, t.lanes = g, t;
      case oe:
        return t = Gt(19, l, n, f), t.elementType = oe, t.lanes = g, t;
      case Ce:
        return dl(l, f, g, n);
      default:
        if (typeof t == "object" && t !== null) switch (t.$$typeof) {
          case I:
            k = 10;
            break e;
          case te:
            k = 9;
            break e;
          case ie:
            k = 11;
            break e;
          case X:
            k = 14;
            break e;
          case ge:
            k = 16, u = null;
            break e;
        }
        throw Error(i(130, t == null ? t : typeof t, ""));
    }
    return n = Gt(k, l, n, f), n.elementType = t, n.type = u, n.lanes = g, n;
  }
  function wr(t, n, l, u) {
    return t = Gt(7, t, u, n), t.lanes = l, t;
  }
  function dl(t, n, l, u) {
    return t = Gt(22, t, u, n), t.elementType = Ce, t.lanes = l, t.stateNode = { isHidden: !1 }, t;
  }
  function xs(t, n, l) {
    return t = Gt(6, t, null, n), t.lanes = l, t;
  }
  function ks(t, n, l) {
    return n = Gt(4, t.children !== null ? t.children : [], t.key, n), n.lanes = l, n.stateNode = { containerInfo: t.containerInfo, pendingChildren: null, implementation: t.implementation }, n;
  }
  function gy(t, n, l, u, f) {
    this.tag = n, this.containerInfo = t, this.finishedWork = this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.pendingContext = this.context = null, this.callbackPriority = 0, this.eventTimes = Gl(0), this.expirationTimes = Gl(-1), this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Gl(0), this.identifierPrefix = u, this.onRecoverableError = f, this.mutableSourceEagerHydrationData = null;
  }
  function ws(t, n, l, u, f, g, k, C, T) {
    return t = new gy(t, n, l, C, T), n === 1 ? (n = 1, g === !0 && (n |= 8)) : n = 0, g = Gt(3, null, null, n), t.current = g, g.stateNode = t, g.memoizedState = { element: u, isDehydrated: l, cache: null, transitions: null, pendingSuspenseBoundaries: null }, Pa(g), t;
  }
  function yy(t, n, l) {
    var u = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return { $$typeof: j, key: u == null ? null : "" + u, children: t, containerInfo: n, implementation: l };
  }
  function Cf(t) {
    if (!t) return Vn;
    t = t._reactInternals;
    e: {
      if (ur(t) !== t || t.tag !== 1) throw Error(i(170));
      var n = t;
      do {
        switch (n.tag) {
          case 3:
            n = n.stateNode.context;
            break e;
          case 1:
            if (jt(n.type)) {
              n = n.stateNode.__reactInternalMemoizedMergedChildContext;
              break e;
            }
        }
        n = n.return;
      } while (n !== null);
      throw Error(i(171));
    }
    if (t.tag === 1) {
      var l = t.type;
      if (jt(l)) return Xc(t, l, n);
    }
    return n;
  }
  function Ef(t, n, l, u, f, g, k, C, T) {
    return t = ws(l, u, !0, t, f, g, k, C, T), t.context = Cf(null), l = t.current, u = Et(), f = Zn(l), g = Ln(u, f), g.callback = n ?? null, Kn(l, g, f), t.current.lanes = f, di(t, f, u), Nt(t, u), t;
  }
  function fl(t, n, l, u) {
    var f = n.current, g = Et(), k = Zn(f);
    return l = Cf(l), n.context === null ? n.context = l : n.pendingContext = l, n = Ln(g, k), n.payload = { element: t }, u = u === void 0 ? null : u, u !== null && (n.callback = u), t = Kn(f, n, k), t !== null && (ln(t, f, k, g), qo(t, f, k)), k;
  }
  function pl(t) {
    if (t = t.current, !t.child) return null;
    switch (t.child.tag) {
      case 5:
        return t.child.stateNode;
      default:
        return t.child.stateNode;
    }
  }
  function _f(t, n) {
    if (t = t.memoizedState, t !== null && t.dehydrated !== null) {
      var l = t.retryLane;
      t.retryLane = l !== 0 && l < n ? l : n;
    }
  }
  function bs(t, n) {
    _f(t, n), (t = t.alternate) && _f(t, n);
  }
  function vy() {
    return null;
  }
  var Tf = typeof reportError == "function" ? reportError : function(t) {
    console.error(t);
  };
  function Ss(t) {
    this._internalRoot = t;
  }
  hl.prototype.render = Ss.prototype.render = function(t) {
    var n = this._internalRoot;
    if (n === null) throw Error(i(409));
    fl(t, n, null, null);
  }, hl.prototype.unmount = Ss.prototype.unmount = function() {
    var t = this._internalRoot;
    if (t !== null) {
      this._internalRoot = null;
      var n = t.containerInfo;
      vr(function() {
        fl(null, t, null, null);
      }), n[En] = null;
    }
  };
  function hl(t) {
    this._internalRoot = t;
  }
  hl.prototype.unstable_scheduleHydration = function(t) {
    if (t) {
      var n = uc();
      t = { blockedOn: null, target: t, priority: n };
      for (var l = 0; l < Bn.length && n !== 0 && n < Bn[l].priority; l++) ;
      Bn.splice(l, 0, t), l === 0 && fc(t);
    }
  };
  function Cs(t) {
    return !(!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11);
  }
  function ml(t) {
    return !(!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11 && (t.nodeType !== 8 || t.nodeValue !== " react-mount-point-unstable "));
  }
  function jf() {
  }
  function xy(t, n, l, u, f) {
    if (f) {
      if (typeof u == "function") {
        var g = u;
        u = function() {
          var M = pl(k);
          g.call(M);
        };
      }
      var k = Ef(n, u, t, 0, null, !1, !1, "", jf);
      return t._reactRootContainer = k, t[En] = k.current, Ei(t.nodeType === 8 ? t.parentNode : t), vr(), k;
    }
    for (; f = t.lastChild; ) t.removeChild(f);
    if (typeof u == "function") {
      var C = u;
      u = function() {
        var M = pl(T);
        C.call(M);
      };
    }
    var T = ws(t, 0, !1, null, null, !1, !1, "", jf);
    return t._reactRootContainer = T, t[En] = T.current, Ei(t.nodeType === 8 ? t.parentNode : t), vr(function() {
      fl(n, T, l, u);
    }), T;
  }
  function gl(t, n, l, u, f) {
    var g = l._reactRootContainer;
    if (g) {
      var k = g;
      if (typeof f == "function") {
        var C = f;
        f = function() {
          var T = pl(k);
          C.call(T);
        };
      }
      fl(n, k, t, f);
    } else k = xy(l, n, t, f, u);
    return pl(k);
  }
  ac = function(t) {
    switch (t.tag) {
      case 3:
        var n = t.stateNode;
        if (n.current.memoizedState.isDehydrated) {
          var l = ci(n.pendingLanes);
          l !== 0 && (Ql(n, l | 1), Nt(n, ot()), (Fe & 6) === 0 && (Jr = ot() + 500, Gn()));
        }
        break;
      case 13:
        vr(function() {
          var u = Rn(t, 1);
          if (u !== null) {
            var f = Et();
            ln(u, t, 1, f);
          }
        }), bs(t, 1);
    }
  }, Kl = function(t) {
    if (t.tag === 13) {
      var n = Rn(t, 134217728);
      if (n !== null) {
        var l = Et();
        ln(n, t, 134217728, l);
      }
      bs(t, 134217728);
    }
  }, sc = function(t) {
    if (t.tag === 13) {
      var n = Zn(t), l = Rn(t, n);
      if (l !== null) {
        var u = Et();
        ln(l, t, n, u);
      }
      bs(t, n);
    }
  }, uc = function() {
    return qe;
  }, cc = function(t, n) {
    var l = qe;
    try {
      return qe = t, n();
    } finally {
      qe = l;
    }
  }, Bl = function(t, n, l) {
    switch (n) {
      case "input":
        if (Jt(t, l), n = l.name, l.type === "radio" && n != null) {
          for (l = t; l.parentNode; ) l = l.parentNode;
          for (l = l.querySelectorAll("input[name=" + JSON.stringify("" + n) + '][type="radio"]'), n = 0; n < l.length; n++) {
            var u = l[n];
            if (u !== t && u.form === t.form) {
              var f = zo(u);
              if (!f) throw Error(i(90));
              Sn(u), Jt(u, f);
            }
          }
        }
        break;
      case "textarea":
        fn(t, l);
        break;
      case "select":
        n = l.value, n != null && un(t, !!l.multiple, n, !1);
    }
  }, Qu = ms, Ku = vr;
  var ky = { usingClientEntryPoint: !1, Events: [ji, Fr, zo, Vu, Gu, ms] }, Hi = { findFiberByHostInstance: cr, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" }, wy = { bundleType: Hi.bundleType, version: Hi.version, rendererPackageName: Hi.rendererPackageName, rendererConfig: Hi.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: ne.ReactCurrentDispatcher, findHostInstanceByFiber: function(t) {
    return t = Zu(t), t === null ? null : t.stateNode;
  }, findFiberByHostInstance: Hi.findFiberByHostInstance || vy, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var yl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!yl.isDisabled && yl.supportsFiber) try {
      ho = yl.inject(wy), pn = yl;
    } catch {
    }
  }
  return At.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = ky, At.createPortal = function(t, n) {
    var l = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
    if (!Cs(n)) throw Error(i(200));
    return yy(t, n, null, l);
  }, At.createRoot = function(t, n) {
    if (!Cs(t)) throw Error(i(299));
    var l = !1, u = "", f = Tf;
    return n != null && (n.unstable_strictMode === !0 && (l = !0), n.identifierPrefix !== void 0 && (u = n.identifierPrefix), n.onRecoverableError !== void 0 && (f = n.onRecoverableError)), n = ws(t, 1, !1, null, null, l, !1, u, f), t[En] = n.current, Ei(t.nodeType === 8 ? t.parentNode : t), new Ss(n);
  }, At.findDOMNode = function(t) {
    if (t == null) return null;
    if (t.nodeType === 1) return t;
    var n = t._reactInternals;
    if (n === void 0)
      throw typeof t.render == "function" ? Error(i(188)) : (t = Object.keys(t).join(","), Error(i(268, t)));
    return t = Zu(n), t = t === null ? null : t.stateNode, t;
  }, At.flushSync = function(t) {
    return vr(t);
  }, At.hydrate = function(t, n, l) {
    if (!ml(n)) throw Error(i(200));
    return gl(null, t, n, !0, l);
  }, At.hydrateRoot = function(t, n, l) {
    if (!Cs(t)) throw Error(i(405));
    var u = l != null && l.hydratedSources || null, f = !1, g = "", k = Tf;
    if (l != null && (l.unstable_strictMode === !0 && (f = !0), l.identifierPrefix !== void 0 && (g = l.identifierPrefix), l.onRecoverableError !== void 0 && (k = l.onRecoverableError)), n = Ef(n, null, t, 1, l ?? null, f, !1, g, k), t[En] = n.current, Ei(t), u) for (t = 0; t < u.length; t++) l = u[t], f = l._getVersion, f = f(l._source), n.mutableSourceEagerHydrationData == null ? n.mutableSourceEagerHydrationData = [l, f] : n.mutableSourceEagerHydrationData.push(
      l,
      f
    );
    return new hl(n);
  }, At.render = function(t, n, l) {
    if (!ml(n)) throw Error(i(200));
    return gl(null, t, n, !1, l);
  }, At.unmountComponentAtNode = function(t) {
    if (!ml(t)) throw Error(i(40));
    return t._reactRootContainer ? (vr(function() {
      gl(null, null, t, !1, function() {
        t._reactRootContainer = null, t[En] = null;
      });
    }), !0) : !1;
  }, At.unstable_batchedUpdates = ms, At.unstable_renderSubtreeIntoContainer = function(t, n, l, u) {
    if (!ml(l)) throw Error(i(200));
    if (t == null || t._reactInternals === void 0) throw Error(i(38));
    return gl(t, n, l, !1, u);
  }, At.version = "18.3.1-next-f1338f8080-20240426", At;
}
var Df;
function Ry() {
  if (Df) return Ts.exports;
  Df = 1;
  function e() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(e);
      } catch (r) {
        console.error(r);
      }
  }
  return e(), Ts.exports = jy(), Ts.exports;
}
var Mf;
function Ly() {
  if (Mf) return vl;
  Mf = 1;
  var e = Ry();
  return vl.createRoot = e.createRoot, vl.hydrateRoot = e.hydrateRoot, vl;
}
var Ny = Ly(), $ = vu();
const xu = /* @__PURE__ */ yu($);
var lh = /```ask-user\s*\n([\s\S]*?)\n```/i;
function Ay(e) {
  if (!e || typeof e != "object") return null;
  const r = e, i = typeof r.question == "string" ? r.question.trim() : "", a = (Array.isArray(r.options) ? r.options : []).map((s) => {
    if (typeof s == "string") return s.trim() ? { label: s.trim() } : null;
    if (s && typeof s == "object") {
      const c = s, d = typeof c.label == "string" ? c.label.trim() : "", p = typeof c.description == "string" ? c.description.trim() : void 0;
      return d ? { label: d, ...p ? { description: p } : {} } : null;
    }
    return null;
  }).filter((s) => !!s);
  return !i || a.length < 2 ? null : { question: i, options: a, multiSelect: r.multiSelect === !0 };
}
function zy(e) {
  var i;
  if (!e || !e.includes("ask-user")) return null;
  const r = (i = e.match(lh)) == null ? void 0 : i[1];
  if (!r) return null;
  try {
    return Ay(JSON.parse(r));
  } catch {
    return null;
  }
}
function Py(e) {
  return e && e.replace(lh, "").replace(/\n{3,}/g, `

`).trim();
}
function Iy(e) {
  return `bf-ask-${e}`;
}
$.createContext(null);
$.createContext(null);
$.createContext(null);
$.createContext(null);
var Dy = "tool";
function My(e) {
  return e.role === Dy;
}
function Oy(e) {
  return e === "own" || e === "shared" || e === "shared_byo_unused" ? e : void 0;
}
function Fy(e) {
  if (!e.metadata) return null;
  try {
    const r = JSON.parse(e.metadata).provenance;
    if (r && typeof r.model == "string" && r.model.length > 0) {
      const i = r.evermind, o = i && typeof i.version == "number" && i.version >= 1 ? { version: i.version } : void 0, a = Oy(r.account), s = typeof r.requestedModel == "string" && r.requestedModel && r.requestedModel !== r.model ? r.requestedModel : void 0;
      return {
        model: r.model,
        ...a ? { account: a } : {},
        ...typeof r.vendor == "string" ? { vendor: r.vendor } : {},
        ...o ? { evermind: o } : {},
        ...s ? { requestedModel: s } : {}
      };
    }
  } catch {
  }
  return null;
}
var $y = "stoppedByUser";
function By(e) {
  var r;
  if (!e.metadata) return !1;
  try {
    return ((r = JSON.parse(e.metadata)) == null ? void 0 : r[$y]) === !0;
  } catch {
    return !1;
  }
}
function Of(e, r, i) {
  return `${e}|${r}|${i ?? ""}`;
}
function Hy(e) {
  if (!e) return null;
  try {
    const r = JSON.parse(e);
    return r.kind !== "step" || typeof r.category != "string" ? null : {
      step: {
        category: r.category,
        label: typeof r.label == "string" ? r.label : r.category,
        args: r.args,
        result: r.result,
        isError: r.isError,
        durationMs: r.durationMs,
        resultBytes: r.resultBytes,
        truncated: r.truncated,
        usage: r.usage,
        finishReason: r.finishReason,
        textChars: r.textChars,
        ttftMs: r.ttftMs
      },
      tsIso: typeof r.ts == "string" ? r.ts : void 0
    };
  } catch {
    return null;
  }
}
function Js(e) {
  const r = e;
  return r && typeof r.ref == "string" && typeof r.name == "string" && (r.kind === "agent" || r.kind === "human") ? { kind: r.kind, ref: r.ref, name: r.name } : null;
}
function Ff(e) {
  if (!e.metadata) return null;
  try {
    return Js(JSON.parse(e.metadata).authoredBy);
  } catch {
  }
  return null;
}
function qy(e) {
  if (!e.metadata) return [];
  try {
    const r = JSON.parse(e.metadata).addressedTo;
    if (!r || typeof r != "object") return [];
    if (r.kind !== "group") {
      const i = Js(r);
      return i ? [i] : [];
    }
    if (Array.isArray(r.members))
      return r.members.map(Js).filter((i) => i !== null);
    if (Array.isArray(r.refs))
      return r.refs.filter((i) => typeof i == "string" && i.length > 0).map((i) => ({ kind: "agent", ref: i, name: i }));
  } catch {
  }
  return [];
}
var Uy = ["path", "file", "filePath", "command", "cmd", "glob", "query", "q", "search", "url", "name", "title", "id"], Wy = 72;
function Vy(e, r = Wy) {
  const i = e.replace(/\s+/g, " ").trim();
  return i.length <= r ? i : i.includes("/") || i.includes("\\") ? `…${i.slice(i.length - (r - 1))}` : `${i.slice(0, r - 1)}…`;
}
function Gy(e) {
  if (!e || typeof e != "object" || Array.isArray(e)) return;
  const r = e;
  for (const i of Uy) {
    const o = r[i];
    if (typeof o == "string" && o.trim()) return Vy(o);
    if (typeof o == "number" && Number.isFinite(o)) return String(o);
  }
}
function Qy(e) {
  return !Number.isFinite(e) || e <= 0 ? "0 B" : e < 1024 ? `${Math.round(e)} B` : `${(e / 1024).toFixed(1)} KB`;
}
var Ky = [
  // The work item itself. `ticket` is the product's word and `task` is the catalog's;
  // this one class is what makes every `tasks.*` tool reachable from a ticket question.
  ["task", "ticket", "issue", "story", "backlog", "todo"],
  // The board and its geography.
  ["kanban", "board", "lane", "swimlane", "column", "card"],
  // Source control.
  ["repo", "repository", "codebase", "git"],
  ["branch", "commit", "merge", "rebase"],
  ["pr", "pull", "pullrequest"],
  // People. `member` is the catalog's word; the rest are what users type.
  ["member", "teammate", "colleague", "people", "person", "staff"],
  // Conversations.
  ["chat", "conversation", "thread"],
  // Delivery planning. `epic` stays OUT of the objective class on purpose — see the
  // header: objectives/OKRs and epics are different entities with different tools.
  ["epic", "feature"],
  ["objective", "okr", "keyresult"],
  // Runs.
  ["execution", "run", "dispatch"]
];
(() => {
  const e = /* @__PURE__ */ new Map();
  for (const r of Ky)
    for (const i of r) {
      const o = e.get(i) ?? [];
      for (const a of r) o.includes(a) || o.push(a);
      e.set(i, o);
    }
  return e;
})();
var ku = ["plan", "code", "verify", "explore", "chat", "utility"], Yy = {
  plan: "Deciding an approach or breaking work down — no code written yet.",
  code: "Writing or editing code. Default when the delegated work is itself an edit.",
  verify: "Checking work already done — reading test/build output, reviewing a diff.",
  explore: "Read-only investigation — locating, searching, summarising. Default when `read_only` is left true.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work — formatting, extraction, a lookup."
}, Xy = new Set(ku);
function Jy(e) {
  return typeof e == "string" && Xy.has(e);
}
function Zy(e, r) {
  return Jy(e) ? e : r ? "explore" : "code";
}
function Ie(e) {
  return {
    name: e.name,
    requires: e.requires ?? [],
    schema: {
      type: "function",
      function: { name: e.name, description: e.description, parameters: e.parameters }
    },
    execute: e.execute
  };
}
function or(e) {
  return typeof e == "string" && /^[\w./@-]+$/.test(e) ? e : null;
}
function wu(e) {
  const r = or(e);
  return r && !r.split(/[\\/]/).includes("..") && !r.startsWith("/") ? r : null;
}
function ah(e, r) {
  const i = wu(r);
  return i ? `cd "${i}" || exit 1
${e}` : e;
}
function sh(e) {
  return {
    data: {
      ok: !1,
      action: e,
      error: 'not a git repository at the workspace root — this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). Do not conclude git is unavailable: call `list_files` to see the top-level directories, then re-run this tool with `repo` set to the one holding the code you are working on (e.g. { "repo": "my-project" }). If none of them is a checkout, say so plainly — file edits still work, only the git tools need a repository.'
    }
  };
}
var oo = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;
function ev(e, r) {
  const i = or(r == null ? void 0 : r.path), o = i ? ` -- "${i}"` : "", a = wu(r == null ? void 0 : r.repo), s = (d) => a ? `cd "${a}" && ${d}` : d, c = (d) => ah(d.join(`
`), r == null ? void 0 : r.repo);
  switch (e) {
    case "status":
      return s("git status --short --branch");
    case "diff":
      return s(`git --no-pager diff${o}`);
    case "history": {
      const d = Number.isFinite(r == null ? void 0 : r.limit) && r.limit > 0 ? Math.min(Math.floor(r.limit), 200) : 30;
      return s(`git --no-pager log --oneline -n ${d}${o}`);
    }
    case "sync_latest": {
      const d = or(r == null ? void 0 : r.baseBranch), p = d ? `BASE="${d}"` : oo;
      return c([
        "set -e",
        p,
        'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
        'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
        'git fetch origin "$BASE"',
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        'echo "Synced with origin/$BASE"'
      ]);
    }
    case "undo":
      return c([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        'echo "Undid the last commit (use git_redo to reapply)"'
      ]);
    case "redo":
      return c([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        'echo "Reapplied the last undone change"'
      ]);
  }
}
function tv(e, r) {
  const i = (r.stdout ?? "").trim();
  return r.exitCode === 3 || /MERGE_CONFLICT/.test(i) ? { data: { ok: !1, action: e, error: "merge conflict — the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: i } } : r.exitCode === 4 || /\bDIRTY\b/.test(i) ? { data: { ok: !1, action: e, error: "you have uncommitted changes — commit or discard them before git_" + e + " (it refuses to discard uncommitted work)." } } : { data: { ok: r.ok, action: e, output: i.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
var nv = /not a git repository/i;
function uh(e) {
  return nv.test(`${e.stdout ?? ""} ${e.error ?? ""}`);
}
async function ii(e, r, i) {
  const o = await i.caps.shell.run(ev(e, r));
  if (uh(o) && !r.repo) return sh(e);
  const a = tv(e, o);
  return r.repo && a.data.ok && (a.data.repo = r.repo), a;
}
var kn = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.'
};
Ie({
  name: "git_status",
  description: "Show the current branch and any uncommitted changes (git status). Use it to see what you have modified before committing, syncing, or finishing. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.",
  parameters: { type: "object", properties: { repo: kn } },
  requires: ["shell"],
  execute: (e, r) => ii("status", { repo: typeof e.repo == "string" ? e.repo : void 0 }, r)
});
Ie({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." }, repo: kn } },
  requires: ["shell"],
  execute: (e, r) => ii("diff", { path: typeof e.path == "string" ? e.path : void 0, repo: typeof e.repo == "string" ? e.repo : void 0 }, r)
});
Ie({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
      repo: kn
    }
  },
  requires: ["shell"],
  execute: (e, r) => ii("history", { path: typeof e.path == "string" ? e.path : void 0, limit: typeof e.limit == "number" ? e.limit : void 0, repo: typeof e.repo == "string" ? e.repo : void 0 }, r)
});
Ie({
  name: "git_sync_latest",
  description: "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing — a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." }, repo: kn } },
  requires: ["shell"],
  execute: (e, r) => ii("sync_latest", { baseBranch: typeof e.baseBranch == "string" ? e.baseBranch : void 0, repo: typeof e.repo == "string" ? e.repo : void 0 }, r)
});
Ie({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable — use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: { repo: kn } },
  requires: ["shell"],
  execute: (e, r) => ii("undo", { repo: typeof e.repo == "string" ? e.repo : void 0 }, r)
});
Ie({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: { repo: kn } },
  requires: ["shell"],
  execute: (e, r) => ii("redo", { repo: typeof e.repo == "string" ? e.repo : void 0 }, r)
});
function Ki(e) {
  return `'${e.replace(/'/g, "'\\''")}'`;
}
function rv(e, r) {
  const i = [e], o = wu(r);
  if (o) {
    const a = `${o.replace(/\/+$/, "")}/`;
    e.startsWith(a) && i.push(e.slice(a.length));
    const s = o.split("/").filter(Boolean).pop();
    s && e.startsWith(`${s}/`) && i.push(e.slice(s.length + 1));
  }
  return [...new Set(i)].filter((a) => a.trim() !== "");
}
function iv(e) {
  const r = or(e.branch), i = e.paths.map((a, s) => {
    const c = rv(a, e.repo).map(Ki).join(" ");
    return `P${s}="$(pick ${c})" || MISSING="$MISSING ${Ki(a).slice(1, -1)}"`;
  }), o = e.paths.map((a, s) => `"$P${s}"`).join(" ");
  return [
    "set -e",
    oo,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: switch to it, creating it if new. Otherwise the base
    // branch is refused — unless the caller DECLARED it, the same declared act `git_push`
    // takes. Without that declaration "commit and push to main" had no reachable path at
    // all: push accepted `allowBaseBranch`, but the commit before it could never land on
    // main, so an explicit human instruction ended in a refusal every time.
    ...r ? [`git rev-parse --verify --quiet "${r}" >/dev/null && git checkout "${r}" || git checkout -b "${r}"`] : e.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // A path is "there" if it is on disk OR tracked by git — the second arm is what
    // lets a DELETION be committed, since the file is gone by definition.
    'pick() { for c in "$@"; do if [ -e "$c" ] || git ls-files --error-unmatch -- "$c" >/dev/null 2>&1; then printf %s "$c"; return 0; fi; done; return 1; }',
    'MISSING=""',
    ...i,
    '[ -z "$MISSING" ] || { echo "MISSING_PATHS:$MISSING"; exit 8; }',
    `git add -- ${o}`,
    // Nothing staged is a fact, not a failure — say which rather than exiting 1 with
    // git's own "nothing to commit" that reads like a broken tool.
    "git diff --cached --quiet && { echo NOTHING_STAGED; exit 6; }",
    `git commit -m ${Ki(e.message)}`,
    'echo "Committed on $(git rev-parse --abbrev-ref HEAD): $(git rev-parse --short HEAD)"'
  ].join(`
`);
}
function ov(e) {
  return [
    "set -e",
    oo,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    ...e.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$CUR"',
    'echo "Pushed $CUR to origin"',
    // Report where the push LANDED — the branch header (`## main...origin/main`, with any
    // `[ahead N]` still owed) plus whatever is still uncommitted. That is the evidence a
    // host needs to call the change shipped, so the push verifies itself rather than
    // depending on the agent remembering a separate status call. Never fails the push.
    "git status --short --branch 2>/dev/null || true"
  ].join(`
`);
}
function lv(e) {
  const r = or(e.base), i = (e.reviewers ?? []).map((o) => or(o)).filter((o) => !!o);
  return [
    "set -e",
    "command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }",
    ...r ? [`BASE="${r}"`] : [oo],
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    '[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || git push -u origin "$CUR"',
    `gh pr create --base "$BASE" --head "$CUR" --title ${Ki(e.title)} --body ${Ki(e.body)}` + i.map((o) => ` --reviewer "${o}"`).join("")
  ].join(`
`);
}
function av(e) {
  const r = or(e.branch), i = or(e.baseBranch);
  return [
    "set -e",
    ...i ? [`BASE="${i}"`] : [oo],
    ...r ? [`TARGET="${r}"`] : ['TARGET="$(git rev-parse --abbrev-ref HEAD)"'],
    '[ "$TARGET" != "$BASE" ] || { echo NOTHING_TO_CLEAN; exit 9; }',
    '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
    'git rev-parse --verify --quiet "$TARGET" >/dev/null || { echo NO_SUCH_BRANCH; exit 11; }',
    // Was this branch ever pushed? Read BEFORE the prune, which is what removes the
    // evidence — a branch that had an upstream and no longer exists on the remote was
    // merged and deleted by the host, however it was merged.
    'HAD_UPSTREAM=0; git rev-parse --verify --quiet "refs/remotes/origin/$TARGET" >/dev/null && HAD_UPSTREAM=1',
    "git fetch --prune origin",
    'REMOTE_EXISTS=0; git ls-remote --exit-code --heads origin "$TARGET" >/dev/null 2>&1 && REMOTE_EXISTS=1',
    // Get onto the base branch and bring it up to date — the state the user expects to
    // be left in. `--ff-only` so a divergent local base is reported, never merged.
    'git checkout "$BASE"',
    'git merge --ff-only "origin/$BASE" >/dev/null 2>&1 || echo "note: local $BASE has diverged from origin/$BASE and was left alone"',
    'MERGED=0; git branch --merged "origin/$BASE" | sed "s/^[* ] *//" | grep -qx "$TARGET" && MERGED=1',
    // Squash-merged: the commits are in the base under a new hash, so `--merged` says
    // no, but the host deleted the remote branch when the PR landed.
    '[ "$MERGED" = 1 ] || { [ "$HAD_UPSTREAM" = 1 ] && [ "$REMOTE_EXISTS" = 0 ] && MERGED=1; } || true',
    ...e.force ? ["MERGED=1"] : [],
    '[ "$MERGED" = 1 ] || { echo NOT_MERGED; exit 10; }',
    // `-D`, not `-d`: the merged-ness check above is STRICTER than git's own (it also
    // accepts the squash-merge case git cannot see), so `-d` would refuse exactly the
    // branches this tool exists to remove. Nothing reaches this line unmerged.
    'git branch -D "$TARGET"',
    // The remote branch is usually ALREADY gone (the host deletes it on merge). That is
    // the goal state, not an error, so it is only pushed when it is actually there.
    '[ "$REMOTE_EXISTS" = 0 ] || git push origin --delete "$TARGET"',
    "git remote prune origin >/dev/null 2>&1 || true",
    'echo "Cleaned up $TARGET — on $BASE (updated), branch deleted locally and on origin"'
  ].join(`
`);
}
function sv(e, r) {
  const i = (r.stdout ?? "").trim(), o = (s) => ({ data: { ok: !1, action: e, error: s, output: i } });
  if (r.exitCode === 5 || /\bON_BASE_BRANCH\b/.test(i))
    return o(
      e === "push" ? "you are on the BASE branch (main/master) and `allowBaseBranch` was not set — pushing here bypasses pull-request review. Open a pull request instead (git_commit with a `branch`, then open_pull_request). If the human has explicitly asked you to push the base branch, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it." : "you are on the BASE branch (main/master) and `allowBaseBranch` was not set — committing here bypasses pull-request review. Pass `branch` to git_commit to work on a ticket branch (it is created for you), then open_pull_request. If the human has explicitly asked you to commit to the base branch directly, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it."
    );
  if (r.exitCode === 6 || /\bNOTHING_STAGED\b/.test(i))
    return o("none of the named paths have uncommitted changes — nothing was committed. Run git_status to see what actually differs; do not report a commit that did not happen.");
  const a = /MISSING_PATHS:([^\n]*)/.exec(i);
  if (r.exitCode === 8 || a) {
    const s = ((a == null ? void 0 : a[1]) ?? "").trim();
    return o(
      `these paths do not exist in the repository, so nothing was committed:${s ? ` ${s}` : ""}. \`paths\` are relative to the REPOSITORY root — when you pass \`repo\`, that means relative to the repo directory, NOT to the workspace root your file tools use. Run git_status (with the same \`repo\`) and copy the paths it prints.`
    );
  }
  return r.exitCode === 9 || /\bNOTHING_TO_CLEAN\b/.test(i) ? o("you are already on the base branch and no ticket branch was named — there is nothing to clean up. Pass `branch` to name the merged branch to delete.") : r.exitCode === 10 || /\bNOT_MERGED\b/.test(i) ? o(
    "that branch's commits are NOT in the base branch, so it was left alone — deleting it would destroy unmerged work. If the pull request was SQUASH-merged (the commits are in main under a new hash and the remote branch still exists), re-call with force:true to delete it anyway."
  ) : r.exitCode === 11 || /\bNO_SUCH_BRANCH\b/.test(i) ? o("no local branch by that name — it has already been deleted. Nothing to do.") : r.exitCode === 4 || /\bDIRTY\b/.test(i) ? o("you have uncommitted changes — commit or discard them before cleaning up (this refuses to discard uncommitted work).") : r.exitCode === 7 || /\bNO_GH_CLI\b/.test(i) ? o("the GitHub CLI (`gh`) is not installed or not on PATH, so a pull request cannot be opened from here. The branch is committed and pushed; tell the human to open the PR, and give them the branch name.") : { data: { ok: r.ok, action: e, output: i.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
async function Pl(e, r, i, o) {
  const a = ah(r, i), s = await o.caps.shell.run(a);
  if (uh(s) && !i) return sh(e);
  const c = sv(e, s);
  return i && c.data.ok && (c.data.repo = i), c;
}
Ie({
  name: "git_commit",
  description: "Commit the files you changed. You must list the exact `paths` to commit — the working tree is shared with the human using it, so committing everything would sweep up their unrelated in-flight work; run git_status/git_diff first if you are unsure what you touched. The DEFAULT route is a TICKET BRANCH: pass `branch` to name it (created for you if it does not exist), then use open_pull_request so the work is reviewed. Without `branch`, a commit is refused while you are on the base branch (main/master) — unless the human has EXPLICITLY asked you to commit to main directly, or your session instructions make you the reviewer of your own change (a local editor session, after you have verified and self-reviewed it); then pass allowBaseBranch:true (the human is prompted to approve it) and follow with git_push allowBaseBranch:true.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message. One line saying what changed and why." },
      paths: { type: "array", items: { type: "string" }, description: "Repo-relative paths to commit. Exactly the files YOU changed — never a catch-all." },
      branch: { type: "string", description: 'Ticket branch to commit on, created if new (e.g. "ticket/2394-mobile-board-height"). The default route; required when on the base branch unless allowBaseBranch is set.' },
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to commit to the base branch (main/master) directly. Default false, which refuses on the base branch and tells you to use a ticket branch." },
      repo: kn
    },
    required: ["message", "paths"]
  },
  requires: ["git.write"],
  execute: (e, r) => {
    const i = typeof e.message == "string" ? e.message.trim() : "";
    if (!i) return Promise.resolve({ data: { ok: !1, action: "commit", error: "message is required" } });
    const o = Array.isArray(e.paths) ? e.paths.filter((s) => typeof s == "string" && s.trim() !== "") : [];
    if (o.length === 0)
      return Promise.resolve({ data: { ok: !1, action: "commit", error: "paths is required — list the exact files you changed. Run git_status to see them. Do not pass '.' or '-A': the working tree may hold changes that are not yours." } });
    const a = typeof e.repo == "string" ? e.repo : void 0;
    return Pl(
      "commit",
      iv({ message: i, paths: o, branch: typeof e.branch == "string" ? e.branch : void 0, allowBaseBranch: e.allowBaseBranch === !0, repo: a }),
      a,
      r
    );
  }
});
Ie({
  name: "git_push",
  description: "Push the current branch to origin (setting its upstream on the first push), then report where it landed (`git status --short --branch`). Pushing the BASE branch (main/master) is refused unless you pass allowBaseBranch — that path skips pull-request review, so only set it when the human has explicitly asked for it, or when your session instructions make you the reviewer of your own change (a local editor session, after verifying and self-reviewing it); the human is prompted to approve it either way. Otherwise the route is a ticket branch: git_commit with a `branch`, git_push, then open_pull_request.",
  parameters: {
    type: "object",
    properties: {
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to push the base branch directly. Default false, which refuses and tells you to open a pull request." },
      repo: kn
    }
  },
  requires: ["git.write"],
  execute: (e, r) => {
    const i = typeof e.repo == "string" ? e.repo : void 0;
    return Pl("push", ov({ allowBaseBranch: e.allowBaseBranch === !0 }), i, r);
  }
});
Ie({
  name: "open_pull_request",
  description: "Open a pull request for the current ticket branch against the base branch, pushing it first if it has no upstream yet. This is how a change gets REVIEWED — prefer it over pushing the base branch, and say so when someone asks you to push directly. Pass `reviewers` to request review from specific people or teams. Returns the pull request URL; report that URL rather than claiming the work is shipped, because it is not until the PR is merged.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Pull request title — what this change does, in one line." },
      body: { type: "string", description: "Pull request description: what changed, why, and how a reviewer can verify it." },
      base: { type: "string", description: "Base branch to target. Defaults to the remote's default branch (usually main)." },
      reviewers: { type: "array", items: { type: "string" }, description: "GitHub usernames or org/team slugs to request review from." },
      repo: kn
    },
    required: ["title", "body"]
  },
  requires: ["git.write"],
  execute: (e, r) => {
    const i = typeof e.title == "string" ? e.title.trim() : "", o = typeof e.body == "string" ? e.body : "";
    if (!i) return Promise.resolve({ data: { ok: !1, action: "pull_request", error: "title is required" } });
    const a = typeof e.repo == "string" ? e.repo : void 0, s = Array.isArray(e.reviewers) ? e.reviewers.filter((c) => typeof c == "string") : void 0;
    return Pl(
      "pull_request",
      lv({ title: i, body: o, base: typeof e.base == "string" ? e.base : void 0, reviewers: s }),
      a,
      r
    );
  }
});
Ie({
  name: "git_cleanup_merged",
  description: "Clean up after work that has LANDED: switch to the base branch, fast-forward it to origin, and delete the merged ticket branch locally and on origin. Call it once the pull request is merged (or once you have pushed the base branch directly) so the checkout is not left sitting on a dead branch with a stale base — do not hand-roll this with run_command. It is IDEMPOTENT: a remote branch the host already deleted on merge is the expected state, not an error. It REFUSES to delete a branch whose commits are not in the base branch, and refuses to run on a dirty working tree, so it can never destroy unmerged or uncommitted work. If the pull request was SQUASH-merged and the remote branch still exists, git cannot see the merge — re-call with force:true.",
  parameters: {
    type: "object",
    properties: {
      branch: { type: "string", description: "The merged branch to delete. Defaults to the branch you are currently on." },
      baseBranch: { type: "string", description: "Branch to return to and update. Defaults to the remote's default branch (usually main)." },
      force: { type: "boolean", description: "Delete the branch even though git cannot see its commits in the base branch. ONLY for a squash-merged pull request you have confirmed is merged." },
      repo: kn
    }
  },
  requires: ["git.write"],
  execute: (e, r) => {
    const i = typeof e.repo == "string" ? e.repo : void 0;
    return Pl(
      "cleanup",
      av({
        branch: typeof e.branch == "string" ? e.branch : void 0,
        baseBranch: typeof e.baseBranch == "string" ? e.baseBranch : void 0,
        force: e.force === !0
      }),
      i,
      r
    );
  }
});
var bu = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "const",
  "struct",
  "trait",
  "module",
  "table",
  "heading"
], uv = 400, cv = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  mts: "js",
  cts: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "oo",
  kt: "oo",
  kts: "oo",
  cs: "oo",
  swift: "oo",
  php: "oo",
  scala: "oo",
  rb: "ruby",
  sql: "sql",
  md: "markdown",
  mdx: "markdown"
};
function dv(e) {
  const r = e.slice(e.lastIndexOf("/") + 1), i = r.lastIndexOf(".");
  return i > 0 ? r.slice(i + 1).toLowerCase() : "";
}
function fv(e) {
  return cv[dv(e.replace(/\\/g, "/"))];
}
function rt(e, r) {
  return e[r] ?? "";
}
function lr(e, r, i) {
  for (let o = 0; o < e.length && r.length < uv; o += 1)
    i(e[o] ?? "", o + 1);
}
var Sr = "[A-Za-z_$][\\w$]*", pv = [
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${Sr})`), kind: "function" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${Sr})`), kind: "class" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?interface\\s+(${Sr})`), kind: "interface" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?type\\s+(${Sr})\\s*[<=]`), kind: "type" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${Sr})`), kind: "enum" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${Sr})`), kind: "const" }
], hv = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(${Sr})\\s*(?:<[^>]*>)?\\s*\\(.*\\)?[^;]*\\{\\s*$`
), mv = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try"]);
function gv(e, r) {
  let i = !1;
  lr(e, r, (o, a) => {
    /^\}/.test(o) && (i = !1);
    for (const d of pv) {
      const p = d.re.exec(o);
      if (!p) continue;
      const h = !!p[1];
      if (!(!h && /^\s/.test(o))) {
        r.push({ name: rt(p, 2), kind: d.kind, line: a, exported: h }), d.kind === "class" && (i = !0);
        return;
      }
    }
    if (!i) return;
    const s = hv.exec(o), c = s ? rt(s, 1) : "";
    c && !mv.has(c) && r.push({ name: c, kind: "method", line: a, exported: !1 });
  });
}
function yv(e, r) {
  lr(e, r, (i, o) => {
    const a = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(i);
    if (!a) return;
    const s = rt(a, 1);
    if (s.length > 4 && !s.startsWith("	")) return;
    const c = rt(a, 3), d = rt(a, 2) === "class" ? "class" : s.length > 0 ? "method" : "function";
    r.push({ name: c, kind: d, line: o, exported: !c.startsWith("_") });
  });
}
function vv(e, r) {
  lr(e, r, (i, o) => {
    const a = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(i);
    if (a) {
      const h = rt(a, 2);
      r.push({ name: h, kind: a[1] ? "method" : "function", line: o, exported: /^[A-Z]/.test(h) });
      return;
    }
    const s = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/.exec(i);
    if (!s) return;
    const c = rt(s, 1), d = rt(s, 2), p = d === "struct" ? "struct" : d === "interface" ? "interface" : "type";
    r.push({ name: c, kind: p, line: o, exported: /^[A-Z]/.test(c) });
  });
}
function xv(e, r) {
  lr(e, r, (i, o) => {
    const a = /^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/.exec(i);
    if (!a) return;
    const s = rt(a, 3), c = s === "fn" ? rt(a, 1).length > 0 ? "method" : "function" : s === "mod" ? "module" : s;
    r.push({ name: rt(a, 4), kind: c, line: o, exported: !!a[2] });
  });
}
var kv = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value)\s+)*(class|interface|enum|record|object|struct|protocol|trait)\s+([A-Za-z_]\w*)/, wv = /^\s*(?:(?:public|private|protected|internal|static|final|override|open|suspend|inline|abstract)\s+)*(?:fun|func|function)\s+([A-Za-z_]\w*)/;
function bv(e, r) {
  lr(e, r, (i, o) => {
    const a = !/\bprivate\b/.test(i), s = kv.exec(i);
    if (s) {
      const d = rt(s, 1), p = d === "interface" || d === "protocol" ? "interface" : d === "enum" ? "enum" : d === "struct" ? "struct" : d === "trait" ? "trait" : "class";
      r.push({ name: rt(s, 2), kind: p, line: o, exported: a });
      return;
    }
    const c = wv.exec(i);
    c && r.push({ name: rt(c, 1), kind: /^\s/.test(i) ? "method" : "function", line: o, exported: a });
  });
}
function Sv(e, r) {
  lr(e, r, (i, o) => {
    const a = /^\s*(class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(i);
    if (a) {
      r.push({ name: rt(a, 2), kind: rt(a, 1) === "module" ? "module" : "class", line: o, exported: !0 });
      return;
    }
    const s = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/.exec(i);
    s && r.push({ name: rt(s, 2), kind: rt(s, 1).length > 0 ? "method" : "function", line: o, exported: !0 });
  });
}
var Cv = /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|materialized\s+view|function|procedure|index|type|trigger)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."]+)/i;
function Ev(e, r) {
  lr(e, r, (i, o) => {
    const a = Cv.exec(i);
    if (!a) return;
    const s = rt(a, 1).toLowerCase(), c = s === "function" || s === "procedure" || s === "trigger" ? "function" : s === "index" || s === "type" ? "type" : "table";
    r.push({ name: rt(a, 2).replace(/"/g, ""), kind: c, line: o, exported: !0 });
  });
}
function _v(e, r) {
  let i = !1;
  lr(e, r, (o, a) => {
    if (/^\s*(```|~~~)/.test(o)) {
      i = !i;
      return;
    }
    if (i) return;
    const s = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(o);
    s && r.push({ name: `${rt(s, 1)} ${rt(s, 2).slice(0, 120)}`, kind: "heading", line: a, exported: !0 });
  });
}
var Tv = {
  js: gv,
  python: yv,
  go: vv,
  rust: xv,
  oo: bv,
  ruby: Sv,
  sql: Ev,
  markdown: _v
};
function jv(e, r) {
  const i = fv(e);
  if (!i) return [];
  const o = [];
  return Tv[i](r.split(/\r?\n/), o), o;
}
function Rv(e) {
  return `L${e.line} ${e.kind} ${e.name}${e.exported && e.kind !== "heading" ? " (export)" : ""}`;
}
var $f = 20, Bf = 50, Lv = 150;
function ch(e) {
  return typeof e == "string" && bu.includes(e) ? e : void 0;
}
Ie({
  name: "find_symbol",
  description: "Find where a function, class, method, type, constant, SQL table or Markdown heading is DEFINED, from the workspace's symbol index — one instant call instead of search_code plus reading files to tell the definition from its call sites. Pass `query` as the symbol name or part of it (case-insensitive; exact matches rank first). Each match is `path:line kind name`; then read_file with `offset` a few lines above that line and a small `limit`. Narrow with `path` (a subdirectory) or `kind`. For USAGES, string literals or config values (not definitions), use search_code instead.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'Symbol name or a distinctive part of it, e.g. "buildGitCommand" or "GitCommand".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      kind: { type: "string", enum: [...bu], description: "Optional: only this kind of definition." },
      limit: { type: "number", description: `Max matches (default ${$f}, max ${Bf}).` }
    },
    required: ["query"]
  },
  requires: ["repo.symbols"],
  async execute(e, r) {
    var h;
    const i = typeof e.query == "string" ? e.query.trim() : "";
    if (!i) return { data: { ok: !1, error: "query is required" } };
    const o = typeof e.path == "string" && e.path.trim() ? e.path.trim() : void 0, a = ch(e.kind), s = typeof e.limit == "number" && Number.isFinite(e.limit) ? Math.floor(e.limit) : $f, c = Math.min(Bf, Math.max(1, s)), d = await r.caps.symbols.find(i, { scope: o, kind: a, limit: c });
    if (!d.ok) return { data: d };
    const p = {
      ok: !0,
      query: i,
      total: d.total ?? 0,
      truncated: d.truncated === !0,
      matches: (d.matches ?? []).map((m) => `${m.path}:${m.line} ${m.kind} ${m.name}${m.exported && m.kind !== "heading" ? " (export)" : ""}`),
      indexedFiles: d.indexedFiles
    };
    return (d.total ?? 0) === 0 ? p.note = d.partialIndex ? `No definition named like "${i}" in the indexed files — but the index is PARTIAL (file cap reached), so this is not proof it does not exist. Try search_code${o ? "" : " with a `path`"}.` : `No definition named like "${i}"${o ? ` under "${o}"` : ""}. It may be defined in a form the index does not recognise (a re-export, an object property, a generated file) — use search_code for the exact text.` : d.truncated && (p.note = `Showing ${((h = d.matches) == null ? void 0 : h.length) ?? 0} of ${d.total} matches — pass a longer \`query\`, a \`path\` or a \`kind\` to narrow.`), { data: p };
  }
});
Ie({
  name: "file_outline",
  description: "List what a file DEFINES — functions, classes, methods, types, constants, or a Markdown file's headings — each with its line number, without reading the file's contents. Call this BEFORE paging through a large file: find the symbol you need, then read_file with `offset` at its line and a small `limit`, instead of reading 2,000-line windows until you reach it. Pass `kind` to list only one kind of definition.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative file path, e.g. "api/src/service.ts".' },
      kind: { type: "string", enum: [...bu], description: "Optional: only this kind of definition." }
    },
    required: ["path"]
  },
  requires: ["repo.read", "repo.symbols"],
  async execute(e, r) {
    var h;
    const i = typeof e.path == "string" ? e.path.trim() : "";
    if (!i) return { data: { ok: !1, error: "path is required" } };
    const o = ch(e.kind), a = await r.caps.repoRead.readFile(i);
    if (!a.ok) return { data: a };
    const s = a.content ?? "", c = jv(i, s).filter((m) => !o || m.kind === o), d = c.slice(0, Lv), p = {
      ok: !0,
      path: a.path ?? i,
      totalLines: s.split(`
`).length,
      total: c.length,
      symbols: d.map(Rv)
    };
    if (c.length === 0)
      p.note = o ? `No ${o} definitions found in ${i}.` : `No definitions recognised in ${i} (unsupported language, or a data/config file) — read_file it directly.`;
    else if (c.length > d.length) {
      const m = ((h = d.at(-1)) == null ? void 0 : h.line) ?? 0;
      p.note = `Showing the first ${d.length} of ${c.length} definitions (through line ${m}). Pass \`kind\` to list one kind, or find_symbol for a specific name.`;
    }
    return { data: p };
  }
});
var Hf = 8, qf = 25, Uf = 1500, Wf = 8e3;
Ie({
  name: "semantic_search",
  description: `Find code by MEANING or by name in one call — returns whole functions/classes (path, line range, symbol, snippet) ranked by identifier-aware keyword match (resolveMembership matches "membership") plus local embeddings. Use it FIRST for questions phrased in words — "where is X handled", "how does Y work", "what validates Z" — where search_code needs an exact substring you do not know yet. Then read_file only the hit you will edit, at its line range. For exact strings, usages and config values use search_code; for a known symbol's definition use find_symbol.`,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'What you are looking for, in words or identifiers, e.g. "stripe webhook to ledger".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      limit: { type: "number", description: `Max results (default ${Hf}, max ${qf}).` }
    },
    required: ["query"]
  },
  requires: ["repo.semantic"],
  async execute(e, r) {
    const i = typeof e.query == "string" ? e.query.trim() : "";
    if (!i) return { data: { ok: !1, error: "query is required" } };
    const o = typeof e.path == "string" && e.path.trim() ? e.path.trim() : void 0, a = typeof e.limit == "number" && Number.isFinite(e.limit) ? Math.floor(e.limit) : Hf, s = Math.min(qf, Math.max(1, a)), c = await r.caps.semantic.search(i, { scope: o, limit: s });
    if (!c.ok) return { data: c };
    const d = (c.results ?? []).map((h) => ({
      at: `${h.path}:${h.startLine}-${h.endLine}`,
      symbol: h.symbol ?? void 0,
      kind: h.kind,
      via: h.source,
      snippet: h.snippet
    })), p = { ok: !0, query: i, total: d.length, results: d };
    return c.indexing ? p.note = "The index is still being built — these results cover only the files scanned so far. A miss is not proof of absence yet; fall back to search_code if needed." : d.length === 0 && (p.note = `Nothing matched "${i}"${o ? ` under "${o}"` : ""}. Rephrase with likely identifier words, drop \`path\`, or use search_code for an exact string.`), { data: p };
  }
});
Ie({
  name: "repo_map",
  description: "The repository's SHAPE in one call: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions as `line: signature`. Call it once at the start of unfamiliar work instead of exploring with list_files and reads; pass `focus` (paths you are working in) to rank that area first.",
  parameters: {
    type: "object",
    properties: {
      focus: { type: "array", items: { type: "string" }, description: 'Optional repo-relative paths to rank first, e.g. ["api/src/billing"].' },
      maxTokens: { type: "number", description: `Budget for the map (default ${Uf}, max ${Wf}).` }
    }
  },
  requires: ["repo.semantic"],
  async execute(e, r) {
    const i = Array.isArray(e.focus) ? e.focus.filter((d) => typeof d == "string" && d.trim() !== "") : [], o = typeof e.maxTokens == "number" && Number.isFinite(e.maxTokens) ? Math.floor(e.maxTokens) : Uf, a = Math.min(Wf, Math.max(200, o)), s = await r.caps.semantic.repoMap({ maxTokens: a, focus: i });
    if (!s.ok) return { data: s };
    const c = { ok: !0, map: s.map ?? "" };
    return s.indexing && (c.note = "The index is still being built — the map covers only the files scanned so far."), { data: c };
  }
});
Ie({
  name: "list_files",
  description: "List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass `path` to scope to a subdirectory. To FIND A FILE BY NAME, pass `glob` — e.g. `ROADMAP.md` (matches that filename at any depth, case-insensitive) or `src/**/*.test.ts`. Use `glob` instead of concluding a file is missing: a large repo's unfiltered listing is summarized to directories, but a `glob` always returns the matching files in full.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
      glob: { type: "string", description: 'Optional filename/glob filter, e.g. "ROADMAP.md", "*.md", or "src/**/*.ts". Case-insensitive; a name with no "/" matches the basename at any depth.' }
    }
  },
  requires: ["repo.read"],
  async execute(e, r) {
    var s;
    const i = typeof e.path == "string" ? e.path : void 0, o = typeof e.glob == "string" && e.glob.trim() ? e.glob.trim() : void 0, a = await r.caps.repoRead.listFiles(i, o);
    return o && a.ok && (((s = a.paths) == null ? void 0 : s.length) ?? 0) === 0 ? {
      data: {
        ...a,
        note: `No file matches glob "${o}". Try a broader pattern (e.g. "*${o.replace(/[*?/]/g, "")}*"), or list_files without a glob to see the tree. 0 matches means no such file exists — do not claim one is missing without trying a broader glob first.`
      }
    } : { data: a };
  }
});
Ie({
  name: "search_code",
  description: 'Search the repo for a string/symbol in one call — use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. Pass `query` as an EXACT substring/regex (a symbol, import path, or config key), NOT a natural-language phrase — a multi-word phrase rarely appears verbatim on one line and will match nothing. On a large monorepo, scope the search with `path` (a subdirectory) to search just that subtree. 0 results with `truncated:false` means the term does not appear (so "remove all references to X" then means there is nothing to remove — say so, do not invent a change); 0 results with `truncated:true` means the search was cut short before scanning everything — narrow it with `path` or a more specific `query` and try again, do NOT conclude the term is absent. Then read_file the matches you intend to edit.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Exact text or symbol to find, e.g. a model id, function name, import path, or config key. NOT a natural-language phrase." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict the search to, e.g. "packages/brain-ui". Use this to avoid truncation on a big repo.' }
    },
    required: ["query"]
  },
  requires: ["repo.search"],
  async execute(e, r) {
    const i = typeof e.query == "string" ? e.query : "";
    if (!i.trim()) return { data: { ok: !1, error: "query is required" } };
    const o = typeof e.path == "string" && e.path.trim() ? e.path.trim() : void 0, a = await r.caps.repoRead.searchCode(i, o);
    if (a.ok && a.total === 0) {
      const s = a.truncated ? `Search was truncated before scanning the whole${o ? " subtree" : " repo"} — this is NOT proof the term is absent. Re-run scoped to a subdirectory via \`path\`${o ? " (a narrower one)" : ""}, or use a more specific \`query\`.` : `No matches${o ? ` under "${o}"` : ""} — the term is not referenced${o ? " there (try without `path` to search the whole repo)" : ""}. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.`;
      return { data: { ...a, note: s } };
    }
    return { data: a };
  }
});
var Zs = 2e3;
function Nv(e, r) {
  const i = e.split(`
`), o = i.length, a = r != null && r.offset && r.offset > 1 ? Math.min(Math.floor(r.offset), o + 1) : 1, s = r != null && r.limit && r.limit > 0 ? Math.floor(r.limit) : Zs, c = i.slice(a - 1, a - 1 + s), d = a - 1 + c.length;
  return { content: c.join(`
`), truncated: d < o, totalLines: o, offset: a, returnedLines: c.length };
}
Ie({
  name: "read_file",
  description: "Read a repo file on the ticket branch. Returns up to " + Zs + " lines at a time: a large file comes back as a paginated line window (never a hard failure), and the result's `truncated`/`totalLines` tell you when more remains — read the next chunk by calling again with `offset`. Always read a file before editing it so you preserve existing code and only change what is needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      offset: { type: "number", description: "1-based line to start reading from (for paging through a large file). Default 1." },
      limit: { type: "number", description: `Max lines to return. Default ${Zs}. Read the next window with offset = previous offset + returned lines.` }
    },
    required: ["path"]
  },
  requires: ["repo.read"],
  async execute(e, r) {
    const i = typeof e.path == "string" ? e.path : "";
    if (!i) return { data: { ok: !1, error: "path is required" } };
    const o = typeof e.offset == "number" && e.offset > 0 ? Math.floor(e.offset) : void 0, a = typeof e.limit == "number" && e.limit > 0 ? Math.floor(e.limit) : void 0, s = await r.caps.repoRead.readFile(i);
    if (!s.ok) return { data: s };
    const c = Nv(s.content ?? "", { offset: o, limit: a }), d = {
      ok: !0,
      path: s.path ?? i,
      content: c.content,
      truncated: c.truncated || s.truncated === !0,
      totalLines: c.totalLines,
      offset: c.offset
    };
    if (c.truncated) {
      const p = c.offset + c.returnedLines - 1;
      d.note = `Showing lines ${c.offset}–${p} of ${c.totalLines}. To continue, call read_file again with offset ${p + 1}.`;
    }
    return { data: d };
  }
});
Ie({
  name: "write_file",
  description: 'Create or update a file, writing its complete contents. How the write lands depends on the surface: in an editor/on-prem workspace it edits the file in place; in a cloud/review run it is staged on the ticket branch as a reviewable pending change. Do NOT narrate a specific mechanism (e.g. "opened a PR") — just state what the file now contains. Use once per deliverable file. Provide the FULL file content.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      content: { type: "string", description: "Complete file content (no placeholders)." },
      summary: { type: "string", description: "One-line description of the change." }
    },
    required: ["path", "content"]
  },
  requires: ["repo.write"],
  async execute(e, r) {
    const i = typeof e.path == "string" ? e.path : "", o = typeof e.content == "string" ? e.content : "", a = typeof e.summary == "string" ? e.summary : void 0;
    if (!i || !o) return { data: { ok: !1, error: "path and content are both required" } };
    const s = await r.caps.repoWrite.writeFile(i, o, a);
    return { data: s.ok ? { ok: !0, branch: s.branch, commitUrl: s.commitUrl } : { ok: !1, error: s.error } };
  }
});
Ie({
  name: "delete_file",
  description: 'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left — reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
      reason: { type: "string", description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' }
    },
    required: ["path"]
  },
  requires: ["repo.delete"],
  async execute(e, r) {
    const i = typeof e.path == "string" ? e.path : "";
    if (!i) return { data: { ok: !1, error: "path is required" } };
    const o = typeof e.reason == "string" ? e.reason : void 0, a = await r.caps.repoWrite.deleteFile(i, o);
    return a.ok && a.deleted === !1 ? { data: { ok: !0, deleted: !1, note: a.note } } : { data: a.ok ? { ok: !0, deleted: !0, branch: a.branch, commitUrl: a.commitUrl } : { ok: !1, error: a.error } };
  }
});
Ie({
  name: "edit_file",
  description: "Make a surgical in-place edit to an existing file on the ticket branch: replace an exact snippet with new text, without rewriting the whole file. Read the file first so `old_string` matches EXACTLY (including indentation). `old_string` must be unique in the file unless you set `replace_all`. Prefer this over write_file for small changes to large files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
      new_string: { type: "string", description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match. Default false." }
    },
    required: ["path", "old_string", "new_string"]
  },
  requires: ["repo.edit"],
  async execute(e, r) {
    const i = typeof e.path == "string" ? e.path : "", o = typeof e.old_string == "string" ? e.old_string : "", a = typeof e.new_string == "string" ? e.new_string : "", s = e.replace_all === !0;
    if (!i || !o) return { data: { ok: !1, error: "path and old_string are required" } };
    const c = await r.caps.repoWrite.editFile(i, o, a, s);
    return {
      data: c.ok ? { ok: !0, branch: c.branch, commitUrl: c.commitUrl, replaced: c.replaced } : { ok: !1, error: c.error }
    };
  }
});
Ie({
  name: "memory_recall",
  description: "Recall durable facts from cross-run memory that are relevant to a query — decisions, fixes, project conventions, user preferences you (or another run) stored earlier. Call this FIRST when a task touches an area you may have worked before, instead of re-reading large files or history. Returns the most relevant stored entries (key + content); 0 results means nothing relevant is stored yet.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to remember about, e.g. a subsystem, decision, or convention." },
      limit: { type: "number", description: "Max entries to return (default 5)." }
    },
    required: ["query"]
  },
  requires: ["memory"],
  async execute(e, r) {
    const i = typeof e.query == "string" ? e.query : "";
    if (!i.trim()) return { data: { ok: !1, error: "query is required" } };
    const o = typeof e.limit == "number" && Number.isFinite(e.limit) ? e.limit : void 0;
    return { data: await r.caps.memory.recall(i, o) };
  }
});
Ie({
  name: "memory_remember",
  description: "Store ONE durable fact in cross-run memory so a future run can recall it instead of re-deriving it — a decision, a non-obvious fix, a project constraint, or a user preference. Keep content to one tight line. Use a stable, descriptive key (e.g. 'release-checklist', 'auth-flow'); reusing a key overwrites it. Do NOT store things the repo/git already records or facts that only matter to the current turn.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Stable, descriptive identifier for the fact, e.g. 'deploy-command'." },
      content: { type: "string", description: "The fact, as one concise line." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags for grouping/filtering." },
      importance: { type: "number", description: "0–1; higher surfaces earlier. Default 0.5." },
      scope: {
        type: "string",
        enum: ["tenant", "project", "ticket"],
        description: "How widely this fact should be visible. 'ticket' = only this ticket's runs; 'project' (default) = every run on this project; 'tenant' = the whole workspace. Prefer the NARROWEST scope that is still true — a project convention is 'project', not 'tenant'."
      },
      ttl_days: {
        type: "number",
        description: "Forget automatically after this many days. Use it for anything time-bound (a release date, a temporary workaround, an in-flight migration). Omit only for facts that stay true indefinitely."
      }
    },
    required: ["key", "content"]
  },
  requires: ["memory"],
  async execute(e, r) {
    const i = typeof e.key == "string" ? e.key : "", o = typeof e.content == "string" ? e.content : "";
    if (!i.trim() || !o.trim()) return { data: { ok: !1, error: "key and content are required" } };
    const a = Array.isArray(e.tags) ? e.tags.filter((h) => typeof h == "string") : void 0, s = typeof e.importance == "number" && Number.isFinite(e.importance) ? e.importance : void 0, c = Av.includes(e.scope) ? e.scope : void 0, d = typeof e.ttl_days == "number" && Number.isFinite(e.ttl_days) && e.ttl_days > 0 ? e.ttl_days : void 0;
    return { data: await r.caps.memory.remember(i, o, { tags: a, importance: s, scope: c, ttlDays: d }) };
  }
});
var Av = ["tenant", "project", "ticket"];
Ie({
  name: "memory_forget",
  description: "Delete one stored fact from cross-run memory by its key. Use when a fact you (or an earlier run) stored has become WRONG — a decision was reversed, a workaround was removed, a convention changed. Correcting a fact is memory_remember with the same key; this is for facts that should no longer exist at all.",
  parameters: {
    type: "object",
    properties: { key: { type: "string", description: "The key of the fact to delete." } },
    required: ["key"]
  },
  requires: ["memory", "memory.forget"],
  async execute(e, r) {
    const i = typeof e.key == "string" ? e.key : "";
    return i.trim() ? { data: await r.caps.memory.forget(i) } : { data: { ok: !1, error: "key is required" } };
  }
});
Ie({
  name: "claim_resource",
  description: "Reserve a shared resource before you work on it, so a peer agent working the same ticket does not change it underneath you. Pass a file path ('src/app.ts'), a directory ('src/api/'), or 'repo' for the whole tree. Returns granted:false with the current holder when someone else has it — then work on something else, or leave a workspace_note explaining what you need. Writes to a path held by another agent are refused whether or not you claim first.",
  parameters: {
    type: "object",
    properties: {
      resource: { type: "string", description: "What to reserve: a repo-relative file path, a directory, or 'repo'." },
      mode: {
        type: "string",
        enum: ["exclusive", "shared"],
        description: "'exclusive' (default) to write it; 'shared' to signal you are reading it and block others' exclusive claims."
      },
      reason: { type: "string", description: "One line on why you need it — shown to the peer agent that gets refused." }
    },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(e, r) {
    const i = typeof e.resource == "string" ? e.resource : "";
    if (!i.trim()) return { data: { ok: !1, error: "resource is required" } };
    const o = e.mode === "shared" || e.mode === "exclusive" ? e.mode : void 0, a = typeof e.reason == "string" ? e.reason : void 0;
    return { data: await r.caps.coordination.claim(i, { mode: o, reason: a }) };
  }
});
Ie({
  name: "release_resource",
  description: "Release a resource you claimed, so a peer agent can take it. Do this as soon as you are finished with it rather than holding it to the end of the run. Every lease this run holds is released automatically when the run ends, so this is an optimisation, not a requirement.",
  parameters: {
    type: "object",
    properties: { resource: { type: "string", description: "The resource string you claimed." } },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(e, r) {
    const i = typeof e.resource == "string" ? e.resource : "";
    return i.trim() ? { data: await r.caps.coordination.release(i) } : { data: { ok: !1, error: "resource is required" } };
  }
});
Ie({
  name: "workspace_note",
  description: "Publish a short note on the shared workspace for this ticket, readable by every agent working it (now or later in the ticket's lifecycle). Use it to declare intent ('I own the DB migration'), hand off a finding, or record a decision a peer must not contradict. Reusing a key overwrites that note. This is WORKING state for the current ticket — durable cross-ticket knowledge belongs in memory_remember.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short stable identifier, e.g. 'owns-migration' or 'api-contract'." },
      content: { type: "string", description: "The note, in one or two lines." }
    },
    required: ["key", "content"]
  },
  requires: ["coordinate"],
  async execute(e, r) {
    const i = typeof e.key == "string" ? e.key : "", o = typeof e.content == "string" ? e.content : "";
    return !i.trim() || !o.trim() ? { data: { ok: !1, error: "key and content are required" } } : { data: await r.caps.coordination.postNote(i, o) };
  }
});
Ie({
  name: "workspace_read",
  description: "Read the shared workspace for this ticket — notes posted by peer agents plus the resources they currently hold. Call this EARLY when a ticket may be staffed by more than one agent, so you plan around what others already own instead of colliding with them.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional filter; omit to read everything." },
      limit: { type: "number", description: "Max notes to return (default 20)." }
    }
  },
  requires: ["coordinate"],
  async execute(e, r) {
    const i = typeof e.query == "string" && e.query.trim() ? e.query : void 0, o = typeof e.limit == "number" && Number.isFinite(e.limit) ? e.limit : void 0, [a, s] = await Promise.all([
      r.caps.coordination.readNotes(i, o),
      r.caps.coordination.listClaims()
    ]);
    return a.ok ? { data: { ok: !0, notes: a.notes ?? [], heldResources: s.ok ? s.leases ?? [] : [] } } : { data: a };
  }
});
Ie({
  name: "web_fetch",
  description: "Fetch a single URL and return its readable text content (HTML is reduced to text/markdown). Use to read documentation, an API spec, an issue, or any page you have an exact URL for. Returns the status and the (possibly truncated) content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The absolute http(s) URL to fetch." }
    },
    required: ["url"]
  },
  requires: ["web"],
  async execute(e, r) {
    const i = typeof e.url == "string" ? e.url : "";
    return i.trim() ? { data: await r.caps.web.fetch(i) } : { data: { ok: !1, error: "url is required" } };
  }
});
Ie({
  name: "web_search",
  description: 'Search the public web for a query and return ranked results (title, url, snippet) plus `coverage` and `attribution`. Use to discover sources/docs when you don\'t have an exact URL; then web_fetch the most relevant result. `coverage: "owned_index"` means this workspace\'s own previously-crawled corpus answered directly; `"web"` or `"encyclopedic"` means a vendor answered and the found pages are being indexed for next time. When `coverage` is "encyclopedic" the index behind this workspace is narrower than a general web engine — report what you actually found and say what you could not find, rather than filling the gap from memory.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." }
    },
    required: ["query"]
  },
  requires: ["web.search"],
  async execute(e, r) {
    var a;
    const i = typeof e.query == "string" ? e.query : "";
    return i.trim() ? (a = r.caps.web) != null && a.search ? { data: await r.caps.web.search(i) } : { data: { ok: !1, error: "web search is not available on this surface" } } : { data: { ok: !1, error: "query is required" } };
  }
});
Ie({
  name: "run_checks",
  description: "Statically validate the files you have written: it parses committed JSON/YAML and runs the platform's shell-free changed-source quality policies, returning structured path/line/rule diagnostics to fix BEFORE finishing. The same validation runs automatically at finish, so it cannot be skipped. IMPORTANT: this serverless executor has NO shell, so it does NOT run the full build, project-wide type-check, lint, or tests — those run in CI on the pull request (the source of truth). Never claim those checks passed.",
  parameters: { type: "object", properties: {} },
  requires: ["static-check"],
  async execute(e, r) {
    return { data: await r.caps.staticCheck.verify() };
  }
});
Ie({
  name: "run_command",
  description: "Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: 'The shell command to run, e.g. "npm install" or "npm test".' }
    },
    required: ["command"]
  },
  requires: ["shell"],
  async execute(e, r) {
    const i = typeof e.command == "string" ? e.command : "";
    return i.trim() ? { data: await r.caps.shell.run(i) } : { data: { ok: !1, error: "command is required" } };
  }
});
Ie({
  name: "ask_human",
  description: `Pause and ask a human for input when you are genuinely BLOCKED — a requirement is ambiguous, you cannot find an expected file/system after searching, a decision needs product/business judgement, or you would otherwise have to guess. The run pauses (no further token spend) and the question goes to the team's human-requests queue with a notification; when someone answers, you resume automatically with their answer and continue. Prefer this over guessing or finishing with a "could not proceed" summary — a blocked task that asks gets unblocked; one that gives up silently does not. Do NOT use it for things you can determine yourself with list_files/search_code/read_file.`,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question for the human. Be concrete and self-contained — they may not have the full task context." },
      context: { type: "string", description: "Optional: what you have tried / why you are blocked, so the human can answer well." }
    },
    required: ["question"]
  },
  requires: ["human"],
  async execute(e, r) {
    const i = typeof e.question == "string" ? e.question.trim() : "", o = typeof e.context == "string" ? e.context : void 0;
    if (!i) return { data: { ok: !1, error: "question is required to ask a human" } };
    const a = await r.caps.human.ask(i, o);
    return a.paused ? {
      control: { kind: "ask_human", approvalId: a.approvalId, question: i },
      data: { ok: !0, paused: !0, note: a.note ?? "Question sent to a human. The run is paused until it is answered; you will resume with the answer." }
    } : { data: { ok: !0, paused: !1, answer: a.answer ?? null, note: a.note } };
  }
});
Ie({
  name: "update_prd",
  description: `Record a change on THIS TICKET'S PRD — the shared spec you were given in your context and that every other agent on this ticket reads. Use mode "append" (the default, and the safe one) to add a dated, signed note: a decision you made, a constraint you discovered, an assumption you had to take, or work you deliberately left out of scope. Use mode "section" ONLY to correct a section that is actually WRONG — it replaces that section's whole body, so pass the full replacement text, not a fragment; name the section by its exact heading (e.g. "Acceptance criteria", "Implementation Notes"). If the heading does not exist the call fails and returns the headings that do — retry with one of those, or append instead. This is not a substitute for doing the work: keep it to what a later run genuinely needs to know.`,
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["append", "section"],
        description: `"append" adds a dated, attributed note at the end (nothing already written is lost). "section" REPLACES the named section's body — only for correcting something wrong.`
      },
      section: {
        type: "string",
        description: 'Required when mode is "section": the exact heading to replace, without the leading "##" (e.g. "Acceptance criteria").'
      },
      content: {
        type: "string",
        description: `The markdown to record. For mode "append", the note. For mode "section", the section's COMPLETE new body.`
      }
    },
    required: ["mode", "content"]
  },
  requires: ["prd.write"],
  async execute(e, r) {
    const i = e.mode === "section" ? "section" : "append", o = typeof e.content == "string" ? e.content.trim() : "";
    if (!o) return { data: { ok: !1, error: "content is required" } };
    if (i === "section") {
      const s = typeof e.section == "string" ? e.section.trim() : "";
      return s ? { data: await r.caps.prd.editSection(s, o) } : {
        data: {
          ok: !1,
          error: 'section is required when mode is "section" — pass the exact heading to replace, or use mode "append" to add a note instead.'
        }
      };
    }
    return { data: await r.caps.prd.append(o) };
  }
});
Ie({
  name: "finish",
  description: 'Call ONLY when the task is fully complete — every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed — you cannot run those here (CI on the PR verifies). If you are blocked rather than done, call ask_human instead of finishing with a "could not proceed" summary.',
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "What was delivered." } },
    required: ["summary"]
  },
  // No capability: every surface can finish. The engine applies the honesty +
  // anti-stub finish gates around this control signal (loop policy, not a tool).
  async execute(e) {
    return { control: { kind: "finish", summary: typeof e.summary == "string" ? e.summary.trim() : "" }, data: { ok: !0 } };
  }
});
Ie({
  name: "skill_propose",
  description: "Propose a reusable SKILL — a procedure a future agent can follow — drafted from work you just completed and verified. Use it when you worked out a repeatable way to do something non-obvious in this codebase (a migration + guard + test sequence, a release path, a debugging route) and a future run would otherwise rediscover it. Do NOT propose a skill for a one-off fix, for something the repo already documents, or for a procedure you did not actually complete. The draft goes to a human for review; it does not take effect until approved.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Stable kebab-case id, e.g. 'add-a-schema-column'. Re-using one revises your existing draft."
      },
      name: { type: "string", description: "Short human title, e.g. 'Add a schema column end to end'." },
      description: {
        type: "string",
        description: "One line saying WHEN to use this skill — a future agent matches on this, so name the situation, not the steps."
      },
      body: {
        type: "string",
        description: "The procedure as Markdown: ordered steps, exact commands, and how to tell it worked."
      },
      evidence: {
        type: "string",
        description: "What proves this procedure works — the graded proof, the merged PR, the passing check."
      }
    },
    required: ["slug", "name", "description", "body"]
  },
  requires: ["skill.author"],
  async execute(e, r) {
    const i = (h) => typeof h == "string" ? h.trim() : "", o = i(e.slug), a = i(e.name), s = i(e.description), c = i(e.body);
    if (!o || !a || !s || !c)
      return { data: { ok: !1, error: "slug, name, description and body are all required" } };
    const d = i(e.evidence);
    return { data: await r.caps.skillAuthor.propose({
      slug: o,
      name: a,
      description: s,
      body: c,
      ...d ? { evidence: d } : {}
    }) };
  }
});
Ie({
  name: "skill_list",
  description: "List the skills this workspace already has — approved ones you can follow, and drafts awaiting review. Call it before proposing, so you revise an existing draft instead of adding a near-duplicate.",
  parameters: { type: "object", properties: {} },
  requires: ["skill.author"],
  async execute(e, r) {
    return { data: await r.caps.skillAuthor.list() };
  }
});
var zv = ku.map((e) => `${e} — ${Yy[e]}`).join(" · ");
Ie({
  name: "spawn_agent",
  description: "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back a single answer. Use it when finding something out would take many turns you do not want to carry — locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose — it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two, and do NOT delegate the actual writing of the deliverable: you are accountable for what ships.",
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A few words naming the delegation, e.g. 'locate the auth middleware'. Shown on the run timeline."
      },
      task: {
        type: "string",
        description: "The child's complete brief: what to find out or do, where to look, and exactly what to report back. Assume it knows nothing about the ticket beyond what you write here."
      },
      read_only: {
        type: "boolean",
        description: "Default true — the child may read, search and reason but not modify the working tree. Pass false ONLY when the delegated work is itself an edit you want it to make."
      },
      role: {
        type: "string",
        enum: [...ku],
        description: `What kind of call the child's turns are — lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'explore' when read_only, else 'code'. ${zv}`
      },
      as_agent: {
        type: "string",
        description: "Run the child AS one of the workspace's agents — its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine."
      }
    },
    required: ["label", "task"]
  },
  requires: ["orchestrate"],
  async execute(e, r) {
    const i = (h) => typeof h == "string" ? h.trim() : "", o = i(e.label), a = i(e.task);
    if (!a) return { data: { ok: !1, error: "task is required — the child sees none of your conversation" } };
    const s = e.read_only !== !1, c = Zy(e.role, s), d = i(e.as_agent), p = await r.caps.orchestration.spawn({
      label: o || a.slice(0, 60),
      task: a,
      readOnly: s,
      role: c,
      ...d ? { asAgent: d } : {}
    });
    return { data: p, ...p.ok ? {} : { isError: !0 } };
  }
});
var Pv = ["started", "completed", "failed", "paused", "resumed", "cancelled"];
function Iv(e) {
  return typeof e == "string" && Pv.includes(e);
}
function vn(e) {
  return typeof e == "string" && e.trim() ? e : void 0;
}
function Dv(e) {
  if (!e.metadata) return null;
  let r;
  try {
    const s = JSON.parse(e.metadata);
    if (!s || typeof s != "object") return null;
    r = s;
  } catch {
    return null;
  }
  const i = vn(r.ticketKind) ?? "task", o = vn(r.ticketRef) ?? "", a = vn(r.agentName) ?? vn(r.agentRef) ?? "";
  return r.runMilestone != null && Iv(r.phase) ? {
    kind: "milestone",
    phase: r.phase,
    agentName: a,
    ticketKind: i,
    ticketRef: o,
    executionId: typeof r.executionId == "number" ? r.executionId : null,
    ...vn(r.toStatus) ? { toStatus: vn(r.toStatus) } : {},
    ...vn(r.note) ? { note: vn(r.note) } : {},
    ...vn(r.question) ? { question: vn(r.question) } : {}
  } : r.agentDispatch === !0 ? { kind: "dispatch", agentName: a, ticketKind: i, ticketRef: o } : null;
}
var Mv = {
  milestoneStarted: "{agent} started working on {kind} #{ref}",
  milestoneCompleted: "{agent} finished {kind} #{ref}",
  milestoneCompletedWithLane: "{agent} finished {kind} #{ref} — moved to {lane}",
  milestoneFailed: "{agent}’s run on {kind} #{ref} failed",
  milestonePaused: "{agent} paused on {kind} #{ref} — waiting on a human answer",
  milestonePausedWithQuestion: "{agent} paused on {kind} #{ref} — needs an answer: {question}",
  milestoneResumed: "{agent} resumed work on {kind} #{ref}",
  milestoneCancelled: "{agent}’s run on {kind} #{ref} was cancelled",
  agentDispatched: "{agent} was assigned to {kind} #{ref}"
};
function Ov(e) {
  if (e.kind === "dispatch") return "👤";
  switch (e.phase) {
    case "started":
      return "▶";
    case "completed":
      return "✓";
    case "failed":
      return "!";
    case "paused":
      return "?";
    case "resumed":
      return "▶";
    case "cancelled":
      return "■";
    default:
      return "•";
  }
}
function Fv(e) {
  return e.kind === "dispatch" ? "neutral" : e.phase === "completed" ? "good" : e.phase === "failed" ? "bad" : e.phase === "paused" ? "waiting" : "neutral";
}
function zn(e, r) {
  return e.replace(/\{(\w+)\}/g, (i, o) => r[o] ?? "");
}
function $v(e, r) {
  const i = { agent: e.agentName, kind: e.ticketKind, ref: e.ticketRef };
  if (e.kind === "dispatch") return zn(r.agentDispatched, i);
  switch (e.phase) {
    case "started":
      return zn(r.milestoneStarted, i);
    case "completed":
      return e.toStatus ? zn(r.milestoneCompletedWithLane, { ...i, lane: e.toStatus }) : zn(r.milestoneCompleted, i);
    case "failed":
      return zn(r.milestoneFailed, i);
    case "paused":
      return e.question ? zn(r.milestonePausedWithQuestion, { ...i, question: e.question }) : zn(r.milestonePaused, i);
    case "resumed":
      return zn(r.milestoneResumed, i);
    case "cancelled":
      return zn(r.milestoneCancelled, i);
    default:
      return "";
  }
}
var Bv = ["designer", "mobile", "webmobile", "evermind", "finetune", "voice"], Hv = 'Strategy and goals live as OKRs/Objectives (Objectives + Key Results) in their own tables — not as tasks on the Kanban board. When the user talks about goals, outcomes, or strategy, you can create and link Objectives and Key Results, and promote an epic titled like "OKR …" into a real Objective, using the platform tools.', Vf = {
  designer: {
    icon: "🌐",
    prompt: [
      "You are an expert AI coding assistant built into Builderforce.ai, a browser-based Builder. Help users generate and build websites and web apps.",
      "When the user describes an app to build, SCAFFOLD IT COMPLETELY in this turn: call the `create_file` tool for every file the app needs to actually run — an index.html entry, a package.json with real dependencies and a `build` script, and all of the src/ components — so the live Preview renders a working app immediately, not a single snippet. Default to a Vite + React app unless the user asks for something else. Prefer `create_file` over pasting code the user must apply by hand. When you have scaffolded the app, tell the user in one line what you built and that Preview is live and it is ready to Publish.",
      "Use markdown for your response: headings, lists, bold, and fenced code blocks.",
      "If the file tools are unavailable, fall back to suggesting files as a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).",
      "When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it."
    ].join(`
`)
  },
  mobile: {
    icon: "📱",
    prompt: [
      "You are an expert mobile app developer operating Builderforce.ai's Canvas Builder. The user is building a MOBILE app and previews it in a phone-sized device simulator.",
      'The project is a React Native app rendered for the web through react-native-web, so it runs in the browser preview AND stays portable to Expo. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" — never use HTML elements like div, span or button, and never use CSS files or className.',
      "Style with StyleSheet.create and flexbox. Remember there is no hover: design for touch, keep tap targets at least 44 points, and respect safe areas at the top and bottom of the screen.",
      "Design for a narrow portrait viewport (roughly 390 x 850 points) first. Prefer native navigation patterns — tab bars, stack headers, bottom sheets — over desktop patterns like sidebars and hover menus.",
      "When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```App.js (then the component), ```src/screens/Home.js.",
      "When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it."
    ].join(`
`)
  },
  webmobile: {
    icon: "🖥️",
    prompt: [
      "You are an expert full-stack app developer built into Builderforce.ai's browser Builder. The user is building ONE app that ships as BOTH a responsive web application AND a mobile app, from a single codebase.",
      'The project is a React app rendered through react-native-web, so the SAME source runs full-width as a website AND inside a phone-sized device simulator, and stays portable to Expo for native iOS/Android. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" — never use HTML elements like div, span or button, and never use CSS files or className.',
      "Style with StyleSheet.create and flexbox, and make layouts RESPONSIVE: use flex, percentage widths and useWindowDimensions to adapt between a wide desktop viewport and a narrow phone one. Keep tap targets at least 44 points and respect safe areas — there is no hover on mobile.",
      "When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```App.js (then the component), ```src/screens/Home.js.",
      "When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it."
    ].join(`
`)
  },
  evermind: {
    icon: "🧠",
    prompt: [
      "You are assisting with growing an Evermind — Builderforce.ai's self-updating model that learns continuously (Write-Through Cognition) instead of being frozen after training.",
      "Help the user teach it: draft facts, skills, and examples to feed it, reason about what it has learned, and interpret its Knowledge Map (neocortex / hippocampus / limbic regions).",
      "This is NOT classic fine-tuning — the model updates in place as it learns. Keep guidance oriented around teaching and recall, not training runs or LoRA adapters."
    ].join(`
`)
  },
  finetune: {
    icon: "🔧",
    prompt: [
      "You are assisting with building and fine-tuning a custom LLM inside Builderforce.ai. This is the classic pipeline: design a dataset, train a LoRA adapter in-browser (WebGPU), benchmark it, then publish and export it.",
      "Help the user draft instruction/response pairs, choose a base model and training hyperparameters, and reason about training runs and benchmark results."
    ].join(`
`)
  },
  voice: {
    icon: "🎙",
    prompt: [
      "You are a voice director inside Builderforce.ai's Voice Studio.",
      "The user enrolls a reference sample to clone a voice (SSM/WebGPU acoustic model) and then synthesizes speech from typed text.",
      "Help them write natural, well-punctuated lines to synthesize, and advise on pacing, emphasis, and tone."
    ].join(`
`)
  }
};
Object.fromEntries(
  Bv.map((e) => [e, { ...Vf[e], prompt: `${Vf[e].prompt}
${Hv}` }])
);
var qv = {
  free: "Builderforce Free",
  pro: "Builderforce PRO"
}, Su = { product: "free", canChoose: !1 };
function Gf(e) {
  return qv[(e ?? Su).product];
}
var Uv = ["project_evermind:", "tenant_model:", "local/"];
function Wv(e) {
  return typeof e == "string" && Uv.some((r) => e.startsWith(r));
}
function Vv(e, r) {
  return r === "own" ? !0 : (e ?? Su).canChoose;
}
function Gv(e, r, i) {
  const o = typeof e == "string" ? e.trim() : "";
  return o && (Wv(o) || Vv(r, i == null ? void 0 : i.account)) ? o : Gf(r);
}
var Qv = /* @__PURE__ */ new Set(["owner", "admin", "manager"]);
function EE(e) {
  return typeof e == "string" && Qv.has(e.toLowerCase());
}
function Kv(e, r) {
  const i = {};
  return (e[e.length - 1] === "" ? [...e, ""] : e).join(
    (i.padRight ? " " : "") + "," + (i.padLeft === !1 ? "" : " ")
  ).trim();
}
const Yv = /^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, Xv = /^[$_\p{ID_Start}][-$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, Jv = {};
function Qf(e, r) {
  return (Jv.jsx ? Xv : Yv).test(e);
}
const Zv = /[ \t\n\f\r]/g;
function ex(e) {
  return typeof e == "object" ? e.type === "text" ? Kf(e.value) : !1 : Kf(e);
}
function Kf(e) {
  return e.replace(Zv, "") === "";
}
class lo {
  /**
   * @param {SchemaType['property']} property
   *   Property.
   * @param {SchemaType['normal']} normal
   *   Normal.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Schema.
   */
  constructor(r, i, o) {
    this.normal = i, this.property = r, o && (this.space = o);
  }
}
lo.prototype.normal = {};
lo.prototype.property = {};
lo.prototype.space = void 0;
function dh(e, r) {
  const i = {}, o = {};
  for (const a of e)
    Object.assign(i, a.property), Object.assign(o, a.normal);
  return new lo(i, o, r);
}
function eu(e) {
  return e.toLowerCase();
}
class Pt {
  /**
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @returns
   *   Info.
   */
  constructor(r, i) {
    this.attribute = i, this.property = r;
  }
}
Pt.prototype.attribute = "";
Pt.prototype.booleanish = !1;
Pt.prototype.boolean = !1;
Pt.prototype.commaOrSpaceSeparated = !1;
Pt.prototype.commaSeparated = !1;
Pt.prototype.defined = !1;
Pt.prototype.mustUseProperty = !1;
Pt.prototype.number = !1;
Pt.prototype.overloadedBoolean = !1;
Pt.prototype.property = "";
Pt.prototype.spaceSeparated = !1;
Pt.prototype.space = void 0;
let tx = 0;
const je = Tr(), st = Tr(), tu = Tr(), K = Tr(), Ve = Tr(), Er = Tr(), Ft = Tr();
function Tr() {
  return 2 ** ++tx;
}
const nu = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  boolean: je,
  booleanish: st,
  commaOrSpaceSeparated: Ft,
  commaSeparated: Er,
  number: K,
  overloadedBoolean: tu,
  spaceSeparated: Ve
}, Symbol.toStringTag, { value: "Module" })), Ls = (
  /** @type {ReadonlyArray<keyof typeof types>} */
  Object.keys(nu)
);
class Cu extends Pt {
  /**
   * @constructor
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @param {number | null | undefined} [mask]
   *   Mask.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Info.
   */
  constructor(r, i, o, a) {
    let s = -1;
    if (super(r, i), Yf(this, "space", a), typeof o == "number")
      for (; ++s < Ls.length; ) {
        const c = Ls[s];
        Yf(this, Ls[s], (o & nu[c]) === nu[c]);
      }
  }
}
Cu.prototype.defined = !0;
function Yf(e, r, i) {
  i && (e[r] = i);
}
function oi(e) {
  const r = {}, i = {};
  for (const [o, a] of Object.entries(e.properties)) {
    const s = new Cu(
      o,
      e.transform(e.attributes || {}, o),
      a,
      e.space
    );
    e.mustUseProperty && e.mustUseProperty.includes(o) && (s.mustUseProperty = !0), r[o] = s, i[eu(o)] = o, i[eu(s.attribute)] = o;
  }
  return new lo(r, i, e.space);
}
const fh = oi({
  properties: {
    ariaActiveDescendant: null,
    ariaAtomic: st,
    ariaAutoComplete: null,
    ariaBusy: st,
    ariaChecked: st,
    ariaColCount: K,
    ariaColIndex: K,
    ariaColSpan: K,
    ariaControls: Ve,
    ariaCurrent: null,
    ariaDescribedBy: Ve,
    ariaDetails: null,
    ariaDisabled: st,
    ariaDropEffect: Ve,
    ariaErrorMessage: null,
    ariaExpanded: st,
    ariaFlowTo: Ve,
    ariaGrabbed: st,
    ariaHasPopup: null,
    ariaHidden: st,
    ariaInvalid: null,
    ariaKeyShortcuts: null,
    ariaLabel: null,
    ariaLabelledBy: Ve,
    ariaLevel: K,
    ariaLive: null,
    ariaModal: st,
    ariaMultiLine: st,
    ariaMultiSelectable: st,
    ariaOrientation: null,
    ariaOwns: Ve,
    ariaPlaceholder: null,
    ariaPosInSet: K,
    ariaPressed: st,
    ariaReadOnly: st,
    ariaRelevant: null,
    ariaRequired: st,
    ariaRoleDescription: Ve,
    ariaRowCount: K,
    ariaRowIndex: K,
    ariaRowSpan: K,
    ariaSelected: st,
    ariaSetSize: K,
    ariaSort: null,
    ariaValueMax: K,
    ariaValueMin: K,
    ariaValueNow: K,
    ariaValueText: null,
    role: null
  },
  transform(e, r) {
    return r === "role" ? r : "aria-" + r.slice(4).toLowerCase();
  }
});
function ph(e, r) {
  return r in e ? e[r] : r;
}
function hh(e, r) {
  return ph(e, r.toLowerCase());
}
const nx = oi({
  attributes: {
    acceptcharset: "accept-charset",
    classname: "class",
    htmlfor: "for",
    httpequiv: "http-equiv"
  },
  mustUseProperty: ["checked", "multiple", "muted", "selected"],
  properties: {
    // Standard Properties.
    abbr: null,
    accept: Er,
    acceptCharset: Ve,
    accessKey: Ve,
    action: null,
    allow: null,
    allowFullScreen: je,
    allowPaymentRequest: je,
    allowUserMedia: je,
    alpha: je,
    alt: null,
    as: null,
    async: je,
    autoCapitalize: null,
    autoComplete: Ve,
    autoFocus: je,
    autoPlay: je,
    blocking: Ve,
    capture: null,
    charSet: null,
    checked: je,
    cite: null,
    className: Ve,
    closedBy: null,
    colorSpace: null,
    cols: K,
    colSpan: K,
    command: null,
    commandFor: null,
    content: null,
    contentEditable: st,
    controls: je,
    controlsList: Ve,
    coords: K | Er,
    crossOrigin: null,
    data: null,
    dateTime: null,
    decoding: null,
    default: je,
    defer: je,
    dir: null,
    dirName: null,
    disabled: je,
    download: tu,
    draggable: st,
    encType: null,
    enterKeyHint: null,
    fetchPriority: null,
    form: null,
    formAction: null,
    formEncType: null,
    formMethod: null,
    formNoValidate: je,
    formTarget: null,
    headers: Ve,
    height: K,
    hidden: tu,
    high: K,
    href: null,
    hrefLang: null,
    htmlFor: Ve,
    httpEquiv: Ve,
    id: null,
    imageSizes: null,
    imageSrcSet: null,
    inert: je,
    inputMode: null,
    integrity: null,
    is: null,
    isMap: je,
    itemId: null,
    itemProp: Ve,
    itemRef: Ve,
    itemScope: je,
    itemType: Ve,
    kind: null,
    label: null,
    lang: null,
    language: null,
    list: null,
    loading: null,
    loop: je,
    low: K,
    manifest: null,
    max: null,
    maxLength: K,
    media: null,
    method: null,
    min: null,
    minLength: K,
    multiple: je,
    muted: je,
    name: null,
    nonce: null,
    noModule: je,
    noValidate: je,
    onAbort: null,
    onAfterPrint: null,
    onAuxClick: null,
    onBeforeMatch: null,
    onBeforePrint: null,
    onBeforeToggle: null,
    onBeforeUnload: null,
    onBlur: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onContextLost: null,
    onContextMenu: null,
    onContextRestored: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFormData: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLanguageChange: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadEnd: null,
    onLoadStart: null,
    onMessage: null,
    onMessageError: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRejectionHandled: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onScrollEnd: null,
    onSecurityPolicyViolation: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onSlotChange: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnhandledRejection: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onWheel: null,
    open: je,
    optimum: K,
    pattern: null,
    ping: Ve,
    placeholder: null,
    playsInline: je,
    popover: null,
    popoverTarget: null,
    popoverTargetAction: null,
    poster: null,
    preload: null,
    readOnly: je,
    referrerPolicy: null,
    rel: Ve,
    required: je,
    reversed: je,
    rows: K,
    rowSpan: K,
    sandbox: Ve,
    scope: null,
    scoped: je,
    seamless: je,
    selected: je,
    shadowRootClonable: je,
    shadowRootCustomElementRegistry: je,
    shadowRootDelegatesFocus: je,
    shadowRootMode: null,
    shadowRootSerializable: je,
    shape: null,
    size: K,
    sizes: null,
    slot: null,
    span: K,
    spellCheck: st,
    src: null,
    srcDoc: null,
    srcLang: null,
    srcSet: null,
    start: K,
    step: null,
    style: null,
    tabIndex: K,
    target: null,
    title: null,
    translate: null,
    type: null,
    typeMustMatch: je,
    useMap: null,
    value: st,
    width: K,
    wrap: null,
    writingSuggestions: null,
    // Legacy.
    // See: https://html.spec.whatwg.org/#other-elements,-attributes-and-apis
    align: null,
    // Several. Use CSS `text-align` instead,
    aLink: null,
    // `<body>`. Use CSS `a:active {color}` instead
    archive: Ve,
    // `<object>`. List of URIs to archives
    axis: null,
    // `<td>` and `<th>`. Use `scope` on `<th>`
    background: null,
    // `<body>`. Use CSS `background-image` instead
    bgColor: null,
    // `<body>` and table elements. Use CSS `background-color` instead
    border: K,
    // `<table>`. Use CSS `border-width` instead,
    borderColor: null,
    // `<table>`. Use CSS `border-color` instead,
    bottomMargin: K,
    // `<body>`
    cellPadding: null,
    // `<table>`
    cellSpacing: null,
    // `<table>`
    char: null,
    // Several table elements. When `align=char`, sets the character to align on
    charOff: null,
    // Several table elements. When `char`, offsets the alignment
    classId: null,
    // `<object>`
    clear: null,
    // `<br>`. Use CSS `clear` instead
    code: null,
    // `<object>`
    codeBase: null,
    // `<object>`
    codeType: null,
    // `<object>`
    color: null,
    // `<font>` and `<hr>`. Use CSS instead
    compact: je,
    // Lists. Use CSS to reduce space between items instead
    declare: je,
    // `<object>`
    event: null,
    // `<script>`
    face: null,
    // `<font>`. Use CSS instead
    frame: null,
    // `<table>`
    frameBorder: null,
    // `<iframe>`. Use CSS `border` instead
    hSpace: K,
    // `<img>` and `<object>`
    leftMargin: K,
    // `<body>`
    link: null,
    // `<body>`. Use CSS `a:link {color: *}` instead
    longDesc: null,
    // `<frame>`, `<iframe>`, and `<img>`. Use an `<a>`
    lowSrc: null,
    // `<img>`. Use a `<picture>`
    marginHeight: K,
    // `<body>`
    marginWidth: K,
    // `<body>`
    noResize: je,
    // `<frame>`
    noHref: je,
    // `<area>`. Use no href instead of an explicit `nohref`
    noShade: je,
    // `<hr>`. Use background-color and height instead of borders
    noWrap: je,
    // `<td>` and `<th>`
    object: null,
    // `<applet>`
    profile: null,
    // `<head>`
    prompt: null,
    // `<isindex>`
    rev: null,
    // `<link>`
    rightMargin: K,
    // `<body>`
    rules: null,
    // `<table>`
    scheme: null,
    // `<meta>`
    scrolling: st,
    // `<frame>`. Use overflow in the child context
    standby: null,
    // `<object>`
    summary: null,
    // `<table>`
    text: null,
    // `<body>`. Use CSS `color` instead
    topMargin: K,
    // `<body>`
    valueType: null,
    // `<param>`
    version: null,
    // `<html>`. Use a doctype.
    vAlign: null,
    // Several. Use CSS `vertical-align` instead
    vLink: null,
    // `<body>`. Use CSS `a:visited {color}` instead
    vSpace: K,
    // `<img>` and `<object>`
    // Non-standard Properties.
    allowTransparency: null,
    autoCorrect: null,
    autoSave: null,
    credentialless: je,
    disablePictureInPicture: je,
    disableRemotePlayback: je,
    exportParts: Er,
    part: Ve,
    prefix: null,
    property: null,
    results: K,
    security: null,
    unselectable: null
  },
  space: "html",
  transform: hh
}), rx = oi({
  attributes: {
    accentHeight: "accent-height",
    alignmentBaseline: "alignment-baseline",
    arabicForm: "arabic-form",
    baselineShift: "baseline-shift",
    capHeight: "cap-height",
    className: "class",
    clipPath: "clip-path",
    clipRule: "clip-rule",
    colorInterpolation: "color-interpolation",
    colorInterpolationFilters: "color-interpolation-filters",
    colorProfile: "color-profile",
    colorRendering: "color-rendering",
    crossOrigin: "crossorigin",
    dataType: "datatype",
    dominantBaseline: "dominant-baseline",
    enableBackground: "enable-background",
    fillOpacity: "fill-opacity",
    fillRule: "fill-rule",
    floodColor: "flood-color",
    floodOpacity: "flood-opacity",
    fontFamily: "font-family",
    fontSize: "font-size",
    fontSizeAdjust: "font-size-adjust",
    fontStretch: "font-stretch",
    fontStyle: "font-style",
    fontVariant: "font-variant",
    fontWeight: "font-weight",
    glyphName: "glyph-name",
    glyphOrientationHorizontal: "glyph-orientation-horizontal",
    glyphOrientationVertical: "glyph-orientation-vertical",
    hrefLang: "hreflang",
    horizAdvX: "horiz-adv-x",
    horizOriginX: "horiz-origin-x",
    horizOriginY: "horiz-origin-y",
    imageRendering: "image-rendering",
    letterSpacing: "letter-spacing",
    lightingColor: "lighting-color",
    markerEnd: "marker-end",
    markerMid: "marker-mid",
    markerStart: "marker-start",
    maskType: "mask-type",
    navDown: "nav-down",
    navDownLeft: "nav-down-left",
    navDownRight: "nav-down-right",
    navLeft: "nav-left",
    navNext: "nav-next",
    navPrev: "nav-prev",
    navRight: "nav-right",
    navUp: "nav-up",
    navUpLeft: "nav-up-left",
    navUpRight: "nav-up-right",
    onAbort: "onabort",
    onActivate: "onactivate",
    onAfterPrint: "onafterprint",
    onBeforePrint: "onbeforeprint",
    onBegin: "onbegin",
    onCancel: "oncancel",
    onCanPlay: "oncanplay",
    onCanPlayThrough: "oncanplaythrough",
    onChange: "onchange",
    onClick: "onclick",
    onClose: "onclose",
    onCopy: "oncopy",
    onCueChange: "oncuechange",
    onCut: "oncut",
    onDblClick: "ondblclick",
    onDrag: "ondrag",
    onDragEnd: "ondragend",
    onDragEnter: "ondragenter",
    onDragExit: "ondragexit",
    onDragLeave: "ondragleave",
    onDragOver: "ondragover",
    onDragStart: "ondragstart",
    onDrop: "ondrop",
    onDurationChange: "ondurationchange",
    onEmptied: "onemptied",
    onEnd: "onend",
    onEnded: "onended",
    onError: "onerror",
    onFocus: "onfocus",
    onFocusIn: "onfocusin",
    onFocusOut: "onfocusout",
    onHashChange: "onhashchange",
    onInput: "oninput",
    onInvalid: "oninvalid",
    onKeyDown: "onkeydown",
    onKeyPress: "onkeypress",
    onKeyUp: "onkeyup",
    onLoad: "onload",
    onLoadedData: "onloadeddata",
    onLoadedMetadata: "onloadedmetadata",
    onLoadStart: "onloadstart",
    onMessage: "onmessage",
    onMouseDown: "onmousedown",
    onMouseEnter: "onmouseenter",
    onMouseLeave: "onmouseleave",
    onMouseMove: "onmousemove",
    onMouseOut: "onmouseout",
    onMouseOver: "onmouseover",
    onMouseUp: "onmouseup",
    onMouseWheel: "onmousewheel",
    onOffline: "onoffline",
    onOnline: "ononline",
    onPageHide: "onpagehide",
    onPageShow: "onpageshow",
    onPaste: "onpaste",
    onPause: "onpause",
    onPlay: "onplay",
    onPlaying: "onplaying",
    onPopState: "onpopstate",
    onProgress: "onprogress",
    onRateChange: "onratechange",
    onRepeat: "onrepeat",
    onReset: "onreset",
    onResize: "onresize",
    onScroll: "onscroll",
    onSeeked: "onseeked",
    onSeeking: "onseeking",
    onSelect: "onselect",
    onShow: "onshow",
    onStalled: "onstalled",
    onStorage: "onstorage",
    onSubmit: "onsubmit",
    onSuspend: "onsuspend",
    onTimeUpdate: "ontimeupdate",
    onToggle: "ontoggle",
    onUnload: "onunload",
    onVolumeChange: "onvolumechange",
    onWaiting: "onwaiting",
    onZoom: "onzoom",
    overlinePosition: "overline-position",
    overlineThickness: "overline-thickness",
    paintOrder: "paint-order",
    panose1: "panose-1",
    pointerEvents: "pointer-events",
    referrerPolicy: "referrerpolicy",
    renderingIntent: "rendering-intent",
    shapeRendering: "shape-rendering",
    stopColor: "stop-color",
    stopOpacity: "stop-opacity",
    strikethroughPosition: "strikethrough-position",
    strikethroughThickness: "strikethrough-thickness",
    strokeDashArray: "stroke-dasharray",
    strokeDashOffset: "stroke-dashoffset",
    strokeLineCap: "stroke-linecap",
    strokeLineJoin: "stroke-linejoin",
    strokeMiterLimit: "stroke-miterlimit",
    strokeOpacity: "stroke-opacity",
    strokeWidth: "stroke-width",
    tabIndex: "tabindex",
    textAnchor: "text-anchor",
    textDecoration: "text-decoration",
    textRendering: "text-rendering",
    transformOrigin: "transform-origin",
    typeOf: "typeof",
    underlinePosition: "underline-position",
    underlineThickness: "underline-thickness",
    unicodeBidi: "unicode-bidi",
    unicodeRange: "unicode-range",
    unitsPerEm: "units-per-em",
    vAlphabetic: "v-alphabetic",
    vHanging: "v-hanging",
    vIdeographic: "v-ideographic",
    vMathematical: "v-mathematical",
    vectorEffect: "vector-effect",
    vertAdvY: "vert-adv-y",
    vertOriginX: "vert-origin-x",
    vertOriginY: "vert-origin-y",
    wordSpacing: "word-spacing",
    writingMode: "writing-mode",
    xHeight: "x-height",
    // These were camelcased in Tiny. Now lowercased in SVG 2
    playbackOrder: "playbackorder",
    timelineBegin: "timelinebegin"
  },
  properties: {
    about: Ft,
    accentHeight: K,
    accumulate: null,
    additive: null,
    alignmentBaseline: null,
    alphabetic: K,
    amplitude: K,
    arabicForm: null,
    ascent: K,
    attributeName: null,
    attributeType: null,
    azimuth: K,
    bandwidth: null,
    baselineShift: null,
    baseFrequency: null,
    baseProfile: null,
    bbox: null,
    begin: null,
    bias: K,
    by: null,
    calcMode: null,
    capHeight: K,
    className: Ve,
    clip: null,
    clipPath: null,
    clipPathUnits: null,
    clipRule: null,
    color: null,
    colorInterpolation: null,
    colorInterpolationFilters: null,
    colorProfile: null,
    colorRendering: null,
    content: null,
    contentScriptType: null,
    contentStyleType: null,
    crossOrigin: null,
    cursor: null,
    cx: null,
    cy: null,
    d: null,
    dataType: null,
    defaultAction: null,
    descent: K,
    diffuseConstant: K,
    direction: null,
    display: null,
    dur: null,
    divisor: K,
    dominantBaseline: null,
    download: je,
    dx: null,
    dy: null,
    edgeMode: null,
    editable: null,
    elevation: K,
    enableBackground: null,
    end: null,
    event: null,
    exponent: K,
    externalResourcesRequired: null,
    fill: null,
    fillOpacity: K,
    fillRule: null,
    filter: null,
    filterRes: null,
    filterUnits: null,
    floodColor: null,
    floodOpacity: null,
    focusable: null,
    focusHighlight: null,
    fontFamily: null,
    fontSize: null,
    fontSizeAdjust: null,
    fontStretch: null,
    fontStyle: null,
    fontVariant: null,
    fontWeight: null,
    format: null,
    fr: null,
    from: null,
    fx: null,
    fy: null,
    g1: Er,
    g2: Er,
    glyphName: Er,
    glyphOrientationHorizontal: null,
    glyphOrientationVertical: null,
    glyphRef: null,
    gradientTransform: null,
    gradientUnits: null,
    handler: null,
    hanging: K,
    hatchContentUnits: null,
    hatchUnits: null,
    height: null,
    href: null,
    hrefLang: null,
    horizAdvX: K,
    horizOriginX: K,
    horizOriginY: K,
    id: null,
    ideographic: K,
    imageRendering: null,
    initialVisibility: null,
    in: null,
    in2: null,
    intercept: K,
    k: K,
    k1: K,
    k2: K,
    k3: K,
    k4: K,
    kernelMatrix: Ft,
    kernelUnitLength: null,
    keyPoints: null,
    // SEMI_COLON_SEPARATED
    keySplines: null,
    // SEMI_COLON_SEPARATED
    keyTimes: null,
    // SEMI_COLON_SEPARATED
    kerning: null,
    lang: null,
    lengthAdjust: null,
    letterSpacing: null,
    lightingColor: null,
    limitingConeAngle: K,
    local: null,
    markerEnd: null,
    markerMid: null,
    markerStart: null,
    markerHeight: null,
    markerUnits: null,
    markerWidth: null,
    mask: null,
    maskContentUnits: null,
    maskType: null,
    maskUnits: null,
    mathematical: null,
    max: null,
    media: null,
    mediaCharacterEncoding: null,
    mediaContentEncodings: null,
    mediaSize: K,
    mediaTime: null,
    method: null,
    min: null,
    mode: null,
    name: null,
    navDown: null,
    navDownLeft: null,
    navDownRight: null,
    navLeft: null,
    navNext: null,
    navPrev: null,
    navRight: null,
    navUp: null,
    navUpLeft: null,
    navUpRight: null,
    numOctaves: null,
    observer: null,
    offset: null,
    onAbort: null,
    onActivate: null,
    onAfterPrint: null,
    onBeforePrint: null,
    onBegin: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnd: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFocusIn: null,
    onFocusOut: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadStart: null,
    onMessage: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onMouseWheel: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRepeat: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onShow: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onZoom: null,
    opacity: null,
    operator: null,
    order: null,
    orient: null,
    orientation: null,
    origin: null,
    overflow: null,
    overlay: null,
    overlinePosition: K,
    overlineThickness: K,
    paintOrder: null,
    panose1: null,
    path: null,
    pathLength: K,
    patternContentUnits: null,
    patternTransform: null,
    patternUnits: null,
    phase: null,
    ping: Ve,
    pitch: null,
    playbackOrder: null,
    pointerEvents: null,
    points: null,
    pointsAtX: K,
    pointsAtY: K,
    pointsAtZ: K,
    preserveAlpha: null,
    preserveAspectRatio: null,
    primitiveUnits: null,
    propagate: null,
    property: Ft,
    r: null,
    radius: null,
    referrerPolicy: null,
    refX: null,
    refY: null,
    rel: Ft,
    rev: Ft,
    renderingIntent: null,
    repeatCount: null,
    repeatDur: null,
    requiredExtensions: Ft,
    requiredFeatures: Ft,
    requiredFonts: Ft,
    requiredFormats: Ft,
    resource: null,
    restart: null,
    result: null,
    rotate: null,
    rx: null,
    ry: null,
    scale: null,
    seed: null,
    shapeRendering: null,
    side: null,
    slope: null,
    snapshotTime: null,
    specularConstant: K,
    specularExponent: K,
    spreadMethod: null,
    spacing: null,
    startOffset: null,
    stdDeviation: null,
    stemh: null,
    stemv: null,
    stitchTiles: null,
    stopColor: null,
    stopOpacity: null,
    strikethroughPosition: K,
    strikethroughThickness: K,
    string: null,
    stroke: null,
    strokeDashArray: Ft,
    strokeDashOffset: null,
    strokeLineCap: null,
    strokeLineJoin: null,
    strokeMiterLimit: K,
    strokeOpacity: K,
    strokeWidth: null,
    style: null,
    surfaceScale: K,
    syncBehavior: null,
    syncBehaviorDefault: null,
    syncMaster: null,
    syncTolerance: null,
    syncToleranceDefault: null,
    systemLanguage: Ft,
    tabIndex: K,
    tableValues: null,
    target: null,
    targetX: K,
    targetY: K,
    textAnchor: null,
    textDecoration: null,
    textRendering: null,
    textLength: null,
    timelineBegin: null,
    title: null,
    transformBehavior: null,
    type: null,
    typeOf: Ft,
    to: null,
    transform: null,
    transformOrigin: null,
    u1: null,
    u2: null,
    underlinePosition: K,
    underlineThickness: K,
    unicode: null,
    unicodeBidi: null,
    unicodeRange: null,
    unitsPerEm: K,
    values: null,
    vAlphabetic: K,
    vMathematical: K,
    vectorEffect: null,
    vHanging: K,
    vIdeographic: K,
    version: null,
    vertAdvY: K,
    vertOriginX: K,
    vertOriginY: K,
    viewBox: null,
    viewTarget: null,
    visibility: null,
    width: null,
    widths: null,
    wordSpacing: null,
    writingMode: null,
    x: null,
    x1: null,
    x2: null,
    xChannelSelector: null,
    xHeight: K,
    y: null,
    y1: null,
    y2: null,
    yChannelSelector: null,
    z: null,
    zoomAndPan: null
  },
  space: "svg",
  transform: ph
}), mh = oi({
  properties: {
    xLinkActuate: null,
    xLinkArcRole: null,
    xLinkHref: null,
    xLinkRole: null,
    xLinkShow: null,
    xLinkTitle: null,
    xLinkType: null
  },
  space: "xlink",
  transform(e, r) {
    return "xlink:" + r.slice(5).toLowerCase();
  }
}), gh = oi({
  attributes: { xmlnsxlink: "xmlns:xlink" },
  properties: { xmlnsXLink: null, xmlns: null },
  space: "xmlns",
  transform: hh
}), yh = oi({
  properties: { xmlBase: null, xmlLang: null, xmlSpace: null },
  space: "xml",
  transform(e, r) {
    return "xml:" + r.slice(3).toLowerCase();
  }
}), ix = {
  classId: "classID",
  dataType: "datatype",
  itemId: "itemID",
  strokeDashArray: "strokeDasharray",
  strokeDashOffset: "strokeDashoffset",
  strokeLineCap: "strokeLinecap",
  strokeLineJoin: "strokeLinejoin",
  strokeMiterLimit: "strokeMiterlimit",
  typeOf: "typeof",
  xLinkActuate: "xlinkActuate",
  xLinkArcRole: "xlinkArcrole",
  xLinkHref: "xlinkHref",
  xLinkRole: "xlinkRole",
  xLinkShow: "xlinkShow",
  xLinkTitle: "xlinkTitle",
  xLinkType: "xlinkType",
  xmlnsXLink: "xmlnsXlink"
}, ox = /[A-Z]/g, Xf = /-[a-z]/g, lx = /^data[-\w.:]+$/i;
function ax(e, r) {
  const i = eu(r);
  let o = r, a = Pt;
  if (i in e.normal)
    return e.property[e.normal[i]];
  if (i.length > 4 && i.slice(0, 4) === "data" && lx.test(r)) {
    if (r.charAt(4) === "-") {
      const s = r.slice(5).replace(Xf, ux);
      o = "data" + s.charAt(0).toUpperCase() + s.slice(1);
    } else {
      const s = r.slice(4);
      if (!Xf.test(s)) {
        let c = s.replace(ox, sx);
        c.charAt(0) !== "-" && (c = "-" + c), r = "data" + c;
      }
    }
    a = Cu;
  }
  return new a(o, r);
}
function sx(e) {
  return "-" + e.toLowerCase();
}
function ux(e) {
  return e.charAt(1).toUpperCase();
}
const cx = dh([fh, nx, mh, gh, yh], "html"), Eu = dh([fh, rx, mh, gh, yh], "svg");
function dx(e) {
  return e.join(" ").trim();
}
var ei = {}, Ns, Jf;
function fx() {
  if (Jf) return Ns;
  Jf = 1;
  var e = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, r = /\n/g, i = /^\s*/, o = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/, a = /^:\s*/, s = /^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/, c = /^[;\s]*/, d = /^\s+|\s+$/g, p = `
`, h = "/", m = "*", v = "", w = "comment", x = "declaration";
  function E(D, z) {
    if (typeof D != "string")
      throw new TypeError("First argument must be a string");
    if (!D) return [];
    z = z || {};
    var U = 1, B = 1;
    function ne(oe) {
      var X = oe.match(r);
      X && (U += X.length);
      var ge = oe.lastIndexOf(p);
      B = ~ge ? oe.length - ge : B + oe.length;
    }
    function Z() {
      var oe = { line: U, column: B };
      return function(X) {
        return X.position = new j(oe), re(), X;
      };
    }
    function j(oe) {
      this.start = oe, this.end = { line: U, column: B }, this.source = z.source;
    }
    j.prototype.content = D;
    function Y(oe) {
      var X = new Error(
        z.source + ":" + U + ":" + B + ": " + oe
      );
      if (X.reason = oe, X.filename = z.source, X.line = U, X.column = B, X.source = D, !z.silent) throw X;
    }
    function se(oe) {
      var X = oe.exec(D);
      if (X) {
        var ge = X[0];
        return ne(ge), D = D.slice(ge.length), X;
      }
    }
    function re() {
      se(i);
    }
    function I(oe) {
      var X;
      for (oe = oe || []; X = te(); )
        X !== !1 && oe.push(X);
      return oe;
    }
    function te() {
      var oe = Z();
      if (!(h != D.charAt(0) || m != D.charAt(1))) {
        for (var X = 2; v != D.charAt(X) && (m != D.charAt(X) || h != D.charAt(X + 1)); )
          ++X;
        if (X += 2, v === D.charAt(X - 1))
          return Y("End of comment missing");
        var ge = D.slice(2, X - 2);
        return B += 2, ne(ge), D = D.slice(X), B += 2, oe({
          type: w,
          comment: ge
        });
      }
    }
    function ie() {
      var oe = Z(), X = se(o);
      if (X) {
        if (te(), !se(a)) return Y("property missing ':'");
        var ge = se(s), Ce = oe({
          type: x,
          property: L(X[0].replace(e, v)),
          value: ge ? L(ge[0].replace(e, v)) : v
        });
        return se(c), Ce;
      }
    }
    function xe() {
      var oe = [];
      I(oe);
      for (var X; X = ie(); )
        X !== !1 && (oe.push(X), I(oe));
      return oe;
    }
    return re(), xe();
  }
  function L(D) {
    return D ? D.replace(d, v) : v;
  }
  return Ns = E, Ns;
}
var Zf;
function px() {
  if (Zf) return ei;
  Zf = 1;
  var e = ei && ei.__importDefault || function(o) {
    return o && o.__esModule ? o : { default: o };
  };
  Object.defineProperty(ei, "__esModule", { value: !0 }), ei.default = i;
  const r = e(fx());
  function i(o, a) {
    let s = null;
    if (!o || typeof o != "string")
      return s;
    const c = (0, r.default)(o), d = typeof a == "function";
    return c.forEach((p) => {
      if (p.type !== "declaration")
        return;
      const { property: h, value: m } = p;
      d ? a(h, m, p) : m && (s = s || {}, s[h] = m);
    }), s;
  }
  return ei;
}
var Ui = {}, ep;
function hx() {
  if (ep) return Ui;
  ep = 1, Object.defineProperty(Ui, "__esModule", { value: !0 }), Ui.camelCase = void 0;
  var e = /^--[a-zA-Z0-9_-]+$/, r = /-([a-z])/g, i = /^[^-]+$/, o = /^-(webkit|moz|ms|o|khtml)-/, a = /^-(ms)-/, s = function(h) {
    return !h || i.test(h) || e.test(h);
  }, c = function(h, m) {
    return m.toUpperCase();
  }, d = function(h, m) {
    return "".concat(m, "-");
  }, p = function(h, m) {
    return m === void 0 && (m = {}), s(h) ? h : (h = h.toLowerCase(), m.reactCompat ? h = h.replace(a, d) : h = h.replace(o, d), h.replace(r, c));
  };
  return Ui.camelCase = p, Ui;
}
var Wi, tp;
function mx() {
  if (tp) return Wi;
  tp = 1;
  var e = Wi && Wi.__importDefault || function(a) {
    return a && a.__esModule ? a : { default: a };
  }, r = e(px()), i = hx();
  function o(a, s) {
    var c = {};
    return !a || typeof a != "string" || (0, r.default)(a, function(d, p) {
      d && p && (c[(0, i.camelCase)(d, s)] = p);
    }), c;
  }
  return o.default = o, Wi = o, Wi;
}
var gx = mx();
const yx = /* @__PURE__ */ yu(gx), vh = xh("end"), _u = xh("start");
function xh(e) {
  return r;
  function r(i) {
    const o = i && i.position && i.position[e] || {};
    if (typeof o.line == "number" && o.line > 0 && typeof o.column == "number" && o.column > 0)
      return {
        line: o.line,
        column: o.column,
        offset: typeof o.offset == "number" && o.offset > -1 ? o.offset : void 0
      };
  }
}
function vx(e) {
  const r = _u(e), i = vh(e);
  if (r && i)
    return { start: r, end: i };
}
function Yi(e) {
  return !e || typeof e != "object" ? "" : "position" in e || "type" in e ? np(e.position) : "start" in e || "end" in e ? np(e) : "line" in e || "column" in e ? ru(e) : "";
}
function ru(e) {
  return rp(e && e.line) + ":" + rp(e && e.column);
}
function np(e) {
  return ru(e && e.start) + "-" + ru(e && e.end);
}
function rp(e) {
  return e && typeof e == "number" ? e : 1;
}
class bt extends Error {
  /**
   * Create a message for `reason`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {Options | null | undefined} [options]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | Options | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns
   *   Instance of `VFileMessage`.
   */
  // eslint-disable-next-line complexity
  constructor(r, i, o) {
    super(), typeof i == "string" && (o = i, i = void 0);
    let a = "", s = {}, c = !1;
    if (i && ("line" in i && "column" in i ? s = { place: i } : "start" in i && "end" in i ? s = { place: i } : "type" in i ? s = {
      ancestors: [i],
      place: i.position
    } : s = { ...i }), typeof r == "string" ? a = r : !s.cause && r && (c = !0, a = r.message, s.cause = r), !s.ruleId && !s.source && typeof o == "string") {
      const p = o.indexOf(":");
      p === -1 ? s.ruleId = o : (s.source = o.slice(0, p), s.ruleId = o.slice(p + 1));
    }
    if (!s.place && s.ancestors && s.ancestors) {
      const p = s.ancestors[s.ancestors.length - 1];
      p && (s.place = p.position);
    }
    const d = s.place && "start" in s.place ? s.place.start : s.place;
    this.ancestors = s.ancestors || void 0, this.cause = s.cause || void 0, this.column = d ? d.column : void 0, this.fatal = void 0, this.file = "", this.message = a, this.line = d ? d.line : void 0, this.name = Yi(s.place) || "1:1", this.place = s.place || void 0, this.reason = this.message, this.ruleId = s.ruleId || void 0, this.source = s.source || void 0, this.stack = c && s.cause && typeof s.cause.stack == "string" ? s.cause.stack : "", this.actual = void 0, this.expected = void 0, this.note = void 0, this.url = void 0;
  }
}
bt.prototype.file = "";
bt.prototype.name = "";
bt.prototype.reason = "";
bt.prototype.message = "";
bt.prototype.stack = "";
bt.prototype.column = void 0;
bt.prototype.line = void 0;
bt.prototype.ancestors = void 0;
bt.prototype.cause = void 0;
bt.prototype.fatal = void 0;
bt.prototype.place = void 0;
bt.prototype.ruleId = void 0;
bt.prototype.source = void 0;
const Tu = {}.hasOwnProperty, xx = /* @__PURE__ */ new Map(), kx = /[A-Z]/g, wx = /* @__PURE__ */ new Set(["table", "tbody", "thead", "tfoot", "tr"]), bx = /* @__PURE__ */ new Set(["td", "th"]), kh = "https://github.com/syntax-tree/hast-util-to-jsx-runtime";
function Sx(e, r) {
  if (!r || r.Fragment === void 0)
    throw new TypeError("Expected `Fragment` in options");
  const i = r.filePath || void 0;
  let o;
  if (r.development) {
    if (typeof r.jsxDEV != "function")
      throw new TypeError(
        "Expected `jsxDEV` in options when `development: true`"
      );
    o = Nx(i, r.jsxDEV);
  } else {
    if (typeof r.jsx != "function")
      throw new TypeError("Expected `jsx` in production options");
    if (typeof r.jsxs != "function")
      throw new TypeError("Expected `jsxs` in production options");
    o = Lx(i, r.jsx, r.jsxs);
  }
  const a = {
    Fragment: r.Fragment,
    ancestors: [],
    components: r.components || {},
    create: o,
    elementAttributeNameCase: r.elementAttributeNameCase || "react",
    evaluater: r.createEvaluater ? r.createEvaluater() : void 0,
    filePath: i,
    ignoreInvalidStyle: r.ignoreInvalidStyle || !1,
    passKeys: r.passKeys !== !1,
    passNode: r.passNode || !1,
    schema: r.space === "svg" ? Eu : cx,
    stylePropertyNameCase: r.stylePropertyNameCase || "dom",
    tableCellAlignToStyle: r.tableCellAlignToStyle !== !1
  }, s = wh(a, e, void 0);
  return s && typeof s != "string" ? s : a.create(
    e,
    a.Fragment,
    { children: s || void 0 },
    void 0
  );
}
function wh(e, r, i) {
  if (r.type === "element")
    return Cx(e, r, i);
  if (r.type === "mdxFlowExpression" || r.type === "mdxTextExpression")
    return Ex(e, r);
  if (r.type === "mdxJsxFlowElement" || r.type === "mdxJsxTextElement")
    return Tx(e, r, i);
  if (r.type === "mdxjsEsm")
    return _x(e, r);
  if (r.type === "root")
    return jx(e, r, i);
  if (r.type === "text")
    return Rx(e, r);
}
function Cx(e, r, i) {
  const o = e.schema;
  let a = o;
  r.tagName.toLowerCase() === "svg" && o.space === "html" && (a = Eu, e.schema = a), e.ancestors.push(r);
  const s = Sh(e, r.tagName, !1), c = Ax(e, r);
  let d = Ru(e, r);
  return wx.has(r.tagName) && (d = d.filter(function(p) {
    return typeof p == "string" ? !ex(p) : !0;
  })), bh(e, c, s, r), ju(c, d), e.ancestors.pop(), e.schema = o, e.create(r, s, c, i);
}
function Ex(e, r) {
  if (r.data && r.data.estree && e.evaluater) {
    const o = r.data.estree.body[0];
    return o.type, /** @type {Child | undefined} */
    e.evaluater.evaluateExpression(o.expression);
  }
  Zi(e, r.position);
}
function _x(e, r) {
  if (r.data && r.data.estree && e.evaluater)
    return (
      /** @type {Child | undefined} */
      e.evaluater.evaluateProgram(r.data.estree)
    );
  Zi(e, r.position);
}
function Tx(e, r, i) {
  const o = e.schema;
  let a = o;
  r.name === "svg" && o.space === "html" && (a = Eu, e.schema = a), e.ancestors.push(r);
  const s = r.name === null ? e.Fragment : Sh(e, r.name, !0), c = zx(e, r), d = Ru(e, r);
  return bh(e, c, s, r), ju(c, d), e.ancestors.pop(), e.schema = o, e.create(r, s, c, i);
}
function jx(e, r, i) {
  const o = {};
  return ju(o, Ru(e, r)), e.create(r, e.Fragment, o, i);
}
function Rx(e, r) {
  return r.value;
}
function bh(e, r, i, o) {
  typeof i != "string" && i !== e.Fragment && e.passNode && (r.node = o);
}
function ju(e, r) {
  if (r.length > 0) {
    const i = r.length > 1 ? r : r[0];
    i && (e.children = i);
  }
}
function Lx(e, r, i) {
  return o;
  function o(a, s, c, d) {
    const h = Array.isArray(c.children) ? i : r;
    return d ? h(s, c, d) : h(s, c);
  }
}
function Nx(e, r) {
  return i;
  function i(o, a, s, c) {
    const d = Array.isArray(s.children), p = _u(o);
    return r(
      a,
      s,
      c,
      d,
      {
        columnNumber: p ? p.column - 1 : void 0,
        fileName: e,
        lineNumber: p ? p.line : void 0
      },
      void 0
    );
  }
}
function Ax(e, r) {
  const i = {};
  let o, a;
  for (a in r.properties)
    if (a !== "children" && Tu.call(r.properties, a)) {
      const s = Px(e, a, r.properties[a]);
      if (s) {
        const [c, d] = s;
        e.tableCellAlignToStyle && c === "align" && typeof d == "string" && bx.has(r.tagName) ? o = d : i[c] = d;
      }
    }
  if (o) {
    const s = (
      /** @type {Style} */
      i.style || (i.style = {})
    );
    s[e.stylePropertyNameCase === "css" ? "text-align" : "textAlign"] = o;
  }
  return i;
}
function zx(e, r) {
  const i = {};
  for (const o of r.attributes)
    if (o.type === "mdxJsxExpressionAttribute")
      if (o.data && o.data.estree && e.evaluater) {
        const s = o.data.estree.body[0];
        s.type;
        const c = s.expression;
        c.type;
        const d = c.properties[0];
        d.type, Object.assign(
          i,
          e.evaluater.evaluateExpression(d.argument)
        );
      } else
        Zi(e, r.position);
    else {
      const a = o.name;
      let s;
      if (o.value && typeof o.value == "object")
        if (o.value.data && o.value.data.estree && e.evaluater) {
          const d = o.value.data.estree.body[0];
          d.type, s = e.evaluater.evaluateExpression(d.expression);
        } else
          Zi(e, r.position);
      else
        s = o.value === null ? !0 : o.value;
      i[a] = /** @type {Props[keyof Props]} */
      s;
    }
  return i;
}
function Ru(e, r) {
  const i = [];
  let o = -1;
  const a = e.passKeys ? /* @__PURE__ */ new Map() : xx;
  for (; ++o < r.children.length; ) {
    const s = r.children[o];
    let c;
    if (e.passKeys) {
      const p = s.type === "element" ? s.tagName : s.type === "mdxJsxFlowElement" || s.type === "mdxJsxTextElement" ? s.name : void 0;
      if (p) {
        const h = a.get(p) || 0;
        c = p + "-" + h, a.set(p, h + 1);
      }
    }
    const d = wh(e, s, c);
    d !== void 0 && i.push(d);
  }
  return i;
}
function Px(e, r, i) {
  const o = ax(e.schema, r);
  if (!(i == null || typeof i == "number" && Number.isNaN(i))) {
    if (Array.isArray(i) && (i = o.commaSeparated ? Kv(i) : dx(i)), o.property === "style") {
      let a = typeof i == "object" ? i : Ix(e, String(i));
      return e.stylePropertyNameCase === "css" && (a = Dx(a)), ["style", a];
    }
    return [
      e.elementAttributeNameCase === "react" && o.space ? ix[o.property] || o.property : o.attribute,
      i
    ];
  }
}
function Ix(e, r) {
  try {
    return yx(r, { reactCompat: !0 });
  } catch (i) {
    if (e.ignoreInvalidStyle)
      return {};
    const o = (
      /** @type {Error} */
      i
    ), a = new bt("Cannot parse `style` attribute", {
      ancestors: e.ancestors,
      cause: o,
      ruleId: "style",
      source: "hast-util-to-jsx-runtime"
    });
    throw a.file = e.filePath || void 0, a.url = kh + "#cannot-parse-style-attribute", a;
  }
}
function Sh(e, r, i) {
  let o;
  if (!i)
    o = { type: "Literal", value: r };
  else if (r.includes(".")) {
    const a = r.split(".");
    let s = -1, c;
    for (; ++s < a.length; ) {
      const d = Qf(a[s]) ? { type: "Identifier", name: a[s] } : { type: "Literal", value: a[s] };
      c = c ? {
        type: "MemberExpression",
        object: c,
        property: d,
        computed: !!(s && d.type === "Literal"),
        optional: !1
      } : d;
    }
    o = c;
  } else
    o = Qf(r) && !/^[a-z]/.test(r) ? { type: "Identifier", name: r } : { type: "Literal", value: r };
  if (o.type === "Literal") {
    const a = (
      /** @type {string | number} */
      o.value
    );
    return Tu.call(e.components, a) ? e.components[a] : a;
  }
  if (e.evaluater)
    return e.evaluater.evaluateExpression(o);
  Zi(e);
}
function Zi(e, r) {
  const i = new bt(
    "Cannot handle MDX estrees without `createEvaluater`",
    {
      ancestors: e.ancestors,
      place: r,
      ruleId: "mdx-estree",
      source: "hast-util-to-jsx-runtime"
    }
  );
  throw i.file = e.filePath || void 0, i.url = kh + "#cannot-handle-mdx-estrees-without-createevaluater", i;
}
function Dx(e) {
  const r = {};
  let i;
  for (i in e)
    Tu.call(e, i) && (r[Mx(i)] = e[i]);
  return r;
}
function Mx(e) {
  let r = e.replace(kx, Ox);
  return r.slice(0, 3) === "ms-" && (r = "-" + r), r;
}
function Ox(e) {
  return "-" + e.toLowerCase();
}
const As = {
  action: ["form"],
  cite: ["blockquote", "del", "ins", "q"],
  data: ["object"],
  formAction: ["button", "input"],
  href: ["a", "area", "base", "link"],
  icon: ["menuitem"],
  itemId: null,
  manifest: ["html"],
  ping: ["a", "area"],
  poster: ["video"],
  src: [
    "audio",
    "embed",
    "iframe",
    "img",
    "input",
    "script",
    "source",
    "track",
    "video"
  ]
}, Fx = {};
function Lu(e, r) {
  const i = Fx, o = typeof i.includeImageAlt == "boolean" ? i.includeImageAlt : !0, a = typeof i.includeHtml == "boolean" ? i.includeHtml : !0;
  return Ch(e, o, a);
}
function Ch(e, r, i) {
  if ($x(e)) {
    if ("value" in e)
      return e.type === "html" && !i ? "" : e.value;
    if (r && "alt" in e && e.alt)
      return e.alt;
    if ("children" in e)
      return ip(e.children, r, i);
  }
  return Array.isArray(e) ? ip(e, r, i) : "";
}
function ip(e, r, i) {
  const o = [];
  let a = -1;
  for (; ++a < e.length; )
    o[a] = Ch(e[a], r, i);
  return o.join("");
}
function $x(e) {
  return !!(e && typeof e == "object");
}
const op = document.createElement("i");
function Nu(e) {
  const r = "&" + e + ";";
  op.innerHTML = r;
  const i = op.textContent;
  return i.charCodeAt(i.length - 1) === 59 && e !== "semi" || i === r ? !1 : i;
}
function $t(e, r, i, o) {
  const a = e.length;
  let s = 0, c;
  if (r < 0 ? r = -r > a ? 0 : a + r : r = r > a ? a : r, i = i > 0 ? i : 0, o.length < 1e4)
    c = Array.from(o), c.unshift(r, i), e.splice(...c);
  else
    for (i && e.splice(r, i); s < o.length; )
      c = o.slice(s, s + 1e4), c.unshift(r, 0), e.splice(...c), s += 1e4, r += 1e4;
}
function Kt(e, r) {
  return e.length > 0 ? ($t(e, e.length, 0, r), e) : r;
}
const lp = {}.hasOwnProperty;
function Eh(e) {
  const r = {};
  let i = -1;
  for (; ++i < e.length; )
    Bx(r, e[i]);
  return r;
}
function Bx(e, r) {
  let i;
  for (i in r) {
    const a = (lp.call(e, i) ? e[i] : void 0) || (e[i] = {}), s = r[i];
    let c;
    if (s)
      for (c in s) {
        lp.call(a, c) || (a[c] = []);
        const d = s[c];
        Hx(
          // @ts-expect-error Looks like a list.
          a[c],
          Array.isArray(d) ? d : d ? [d] : []
        );
      }
  }
}
function Hx(e, r) {
  let i = -1;
  const o = [];
  for (; ++i < r.length; )
    (r[i].add === "after" ? e : o).push(r[i]);
  $t(e, 0, 0, o);
}
function _h(e, r) {
  const i = Number.parseInt(e, r);
  return (
    // C0 except for HT, LF, FF, CR, space.
    i < 9 || i === 11 || i > 13 && i < 32 || // Control character (DEL) of C0, and C1 controls.
    i > 126 && i < 160 || // Lone high surrogates and low surrogates.
    i > 55295 && i < 57344 || // Noncharacters.
    i > 64975 && i < 65008 || /* eslint-disable no-bitwise */
    (i & 65535) === 65535 || (i & 65535) === 65534 || /* eslint-enable no-bitwise */
    // Out of range
    i > 1114111 ? "�" : String.fromCodePoint(i)
  );
}
function an(e) {
  return e.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
const _t = ar(/[A-Za-z]/), wt = ar(/[\dA-Za-z]/), qx = ar(/[#-'*+\--9=?A-Z^-~]/);
function Tl(e) {
  return (
    // Special whitespace codes (which have negative values), C0 and Control
    // character DEL
    e !== null && (e < 32 || e === 127)
  );
}
const iu = ar(/\d/), Ux = ar(/[\dA-Fa-f]/), Wx = ar(/[!-/:-@[-`{-~]/);
function Se(e) {
  return e !== null && e < -2;
}
function Ge(e) {
  return e !== null && (e < 0 || e === 32);
}
function Pe(e) {
  return e === -2 || e === -1 || e === 32;
}
const Il = ar(new RegExp("\\p{P}|\\p{S}", "u")), _r = ar(/\s/);
function ar(e) {
  return r;
  function r(i) {
    return i !== null && i > -1 && e.test(String.fromCharCode(i));
  }
}
function li(e) {
  const r = [];
  let i = -1, o = 0, a = 0;
  for (; ++i < e.length; ) {
    const s = e.charCodeAt(i);
    let c = "";
    if (s === 37 && wt(e.charCodeAt(i + 1)) && wt(e.charCodeAt(i + 2)))
      a = 2;
    else if (s < 128)
      /[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(s)) || (c = String.fromCharCode(s));
    else if (s > 55295 && s < 57344) {
      const d = e.charCodeAt(i + 1);
      s < 56320 && d > 56319 && d < 57344 ? (c = String.fromCharCode(s, d), a = 1) : c = "�";
    } else
      c = String.fromCharCode(s);
    c && (r.push(e.slice(o, i), encodeURIComponent(c)), o = i + a + 1, c = ""), a && (i += a, a = 0);
  }
  return r.join("") + e.slice(o);
}
function Oe(e, r, i, o) {
  const a = o ? o - 1 : Number.POSITIVE_INFINITY;
  let s = 0;
  return c;
  function c(p) {
    return Pe(p) ? (e.enter(i), d(p)) : r(p);
  }
  function d(p) {
    return Pe(p) && s++ < a ? (e.consume(p), d) : (e.exit(i), r(p));
  }
}
const Vx = {
  tokenize: Gx
};
function Gx(e) {
  const r = e.attempt(this.parser.constructs.contentInitial, o, a);
  let i;
  return r;
  function o(d) {
    if (d === null) {
      e.consume(d);
      return;
    }
    return e.enter("lineEnding"), e.consume(d), e.exit("lineEnding"), Oe(e, r, "linePrefix");
  }
  function a(d) {
    return e.enter("paragraph"), s(d);
  }
  function s(d) {
    const p = e.enter("chunkText", {
      contentType: "text",
      previous: i
    });
    return i && (i.next = p), i = p, c(d);
  }
  function c(d) {
    if (d === null) {
      e.exit("chunkText"), e.exit("paragraph"), e.consume(d);
      return;
    }
    return Se(d) ? (e.consume(d), e.exit("chunkText"), s) : (e.consume(d), c);
  }
}
const Qx = {
  tokenize: Kx
}, ap = {
  tokenize: Yx
};
function Kx(e) {
  const r = this, i = [];
  let o = 0, a, s, c;
  return d;
  function d(B) {
    if (o < i.length) {
      const ne = i[o];
      return r.containerState = ne[1], e.attempt(ne[0].continuation, p, h)(B);
    }
    return h(B);
  }
  function p(B) {
    if (o++, r.containerState._closeFlow) {
      r.containerState._closeFlow = void 0, a && U();
      const ne = r.events.length;
      let Z = ne, j;
      for (; Z--; )
        if (r.events[Z][0] === "exit" && r.events[Z][1].type === "chunkFlow") {
          j = r.events[Z][1].end;
          break;
        }
      z(o);
      let Y = ne;
      for (; Y < r.events.length; )
        r.events[Y][1].end = {
          ...j
        }, Y++;
      return $t(r.events, Z + 1, 0, r.events.slice(ne)), r.events.length = Y, h(B);
    }
    return d(B);
  }
  function h(B) {
    if (o === i.length) {
      if (!a)
        return w(B);
      if (a.currentConstruct && a.currentConstruct.concrete)
        return E(B);
      r.interrupt = !!(a.currentConstruct && !a._gfmTableDynamicInterruptHack);
    }
    return r.containerState = {}, e.check(ap, m, v)(B);
  }
  function m(B) {
    return a && U(), z(o), w(B);
  }
  function v(B) {
    return r.parser.lazy[r.now().line] = o !== i.length, c = r.now().offset, E(B);
  }
  function w(B) {
    return r.containerState = {}, e.attempt(ap, x, E)(B);
  }
  function x(B) {
    return o++, i.push([r.currentConstruct, r.containerState]), w(B);
  }
  function E(B) {
    if (B === null) {
      a && U(), z(0), e.consume(B);
      return;
    }
    return a = a || r.parser.flow(r.now()), e.enter("chunkFlow", {
      _tokenizer: a,
      contentType: "flow",
      previous: s
    }), L(B);
  }
  function L(B) {
    if (B === null) {
      D(e.exit("chunkFlow"), !0), z(0), e.consume(B);
      return;
    }
    return Se(B) ? (e.consume(B), D(e.exit("chunkFlow")), o = 0, r.interrupt = void 0, d) : (e.consume(B), L);
  }
  function D(B, ne) {
    const Z = r.sliceStream(B);
    if (ne && Z.push(null), B.previous = s, s && (s.next = B), s = B, a.defineSkip(B.start), a.write(Z), r.parser.lazy[B.start.line]) {
      let j = a.events.length;
      for (; j--; )
        if (
          // The token starts before the line ending…
          a.events[j][1].start.offset < c && // …and either is not ended yet…
          (!a.events[j][1].end || // …or ends after it.
          a.events[j][1].end.offset > c)
        )
          return;
      const Y = r.events.length;
      let se = Y, re, I;
      for (; se--; )
        if (r.events[se][0] === "exit" && r.events[se][1].type === "chunkFlow") {
          if (re) {
            I = r.events[se][1].end;
            break;
          }
          re = !0;
        }
      for (z(o), j = Y; j < r.events.length; )
        r.events[j][1].end = {
          ...I
        }, j++;
      $t(r.events, se + 1, 0, r.events.slice(Y)), r.events.length = j;
    }
  }
  function z(B) {
    let ne = i.length;
    for (; ne-- > B; ) {
      const Z = i[ne];
      r.containerState = Z[1], Z[0].exit.call(r, e);
    }
    i.length = B;
  }
  function U() {
    a.write([null]), s = void 0, a = void 0, r.containerState._closeFlow = void 0;
  }
}
function Yx(e, r, i) {
  return Oe(e, e.attempt(this.parser.constructs.document, r, i), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
function ni(e) {
  if (e === null || Ge(e) || _r(e))
    return 1;
  if (Il(e))
    return 2;
}
function Dl(e, r, i) {
  const o = [];
  let a = -1;
  for (; ++a < e.length; ) {
    const s = e[a].resolveAll;
    s && !o.includes(s) && (r = s(r, i), o.push(s));
  }
  return r;
}
const ou = {
  name: "attention",
  resolveAll: Xx,
  tokenize: Jx
};
function Xx(e, r) {
  let i = -1, o, a, s, c, d, p, h, m;
  for (; ++i < e.length; )
    if (e[i][0] === "enter" && e[i][1].type === "attentionSequence" && e[i][1]._close) {
      for (o = i; o--; )
        if (e[o][0] === "exit" && e[o][1].type === "attentionSequence" && e[o][1]._open && // If the markers are the same:
        r.sliceSerialize(e[o][1]).charCodeAt(0) === r.sliceSerialize(e[i][1]).charCodeAt(0)) {
          if ((e[o][1]._close || e[i][1]._open) && (e[i][1].end.offset - e[i][1].start.offset) % 3 && !((e[o][1].end.offset - e[o][1].start.offset + e[i][1].end.offset - e[i][1].start.offset) % 3))
            continue;
          p = e[o][1].end.offset - e[o][1].start.offset > 1 && e[i][1].end.offset - e[i][1].start.offset > 1 ? 2 : 1;
          const v = {
            ...e[o][1].end
          }, w = {
            ...e[i][1].start
          };
          sp(v, -p), sp(w, p), c = {
            type: p > 1 ? "strongSequence" : "emphasisSequence",
            start: v,
            end: {
              ...e[o][1].end
            }
          }, d = {
            type: p > 1 ? "strongSequence" : "emphasisSequence",
            start: {
              ...e[i][1].start
            },
            end: w
          }, s = {
            type: p > 1 ? "strongText" : "emphasisText",
            start: {
              ...e[o][1].end
            },
            end: {
              ...e[i][1].start
            }
          }, a = {
            type: p > 1 ? "strong" : "emphasis",
            start: {
              ...c.start
            },
            end: {
              ...d.end
            }
          }, e[o][1].end = {
            ...c.start
          }, e[i][1].start = {
            ...d.end
          }, h = [], e[o][1].end.offset - e[o][1].start.offset && (h = Kt(h, [["enter", e[o][1], r], ["exit", e[o][1], r]])), h = Kt(h, [["enter", a, r], ["enter", c, r], ["exit", c, r], ["enter", s, r]]), h = Kt(h, Dl(r.parser.constructs.insideSpan.null, e.slice(o + 1, i), r)), h = Kt(h, [["exit", s, r], ["enter", d, r], ["exit", d, r], ["exit", a, r]]), e[i][1].end.offset - e[i][1].start.offset ? (m = 2, h = Kt(h, [["enter", e[i][1], r], ["exit", e[i][1], r]])) : m = 0, $t(e, o - 1, i - o + 3, h), i = o + h.length - m - 2;
          break;
        }
    }
  for (i = -1; ++i < e.length; )
    e[i][1].type === "attentionSequence" && (e[i][1].type = "data");
  return e;
}
function Jx(e, r) {
  const i = this.parser.constructs.attentionMarkers.null, o = this.previous, a = ni(o);
  let s;
  return c;
  function c(p) {
    return s = p, e.enter("attentionSequence"), d(p);
  }
  function d(p) {
    if (p === s)
      return e.consume(p), d;
    const h = e.exit("attentionSequence"), m = ni(p), v = !m || m === 2 && a || i.includes(p), w = !a || a === 2 && m || i.includes(o);
    return h._open = !!(s === 42 ? v : v && (a || !w)), h._close = !!(s === 42 ? w : w && (m || !v)), r(p);
  }
}
function sp(e, r) {
  e.column += r, e.offset += r, e._bufferIndex += r;
}
const Zx = {
  name: "autolink",
  tokenize: ek
};
function ek(e, r, i) {
  let o = 0;
  return a;
  function a(x) {
    return e.enter("autolink"), e.enter("autolinkMarker"), e.consume(x), e.exit("autolinkMarker"), e.enter("autolinkProtocol"), s;
  }
  function s(x) {
    return _t(x) ? (e.consume(x), c) : x === 64 ? i(x) : h(x);
  }
  function c(x) {
    return x === 43 || x === 45 || x === 46 || wt(x) ? (o = 1, d(x)) : h(x);
  }
  function d(x) {
    return x === 58 ? (e.consume(x), o = 0, p) : (x === 43 || x === 45 || x === 46 || wt(x)) && o++ < 32 ? (e.consume(x), d) : (o = 0, h(x));
  }
  function p(x) {
    return x === 62 ? (e.exit("autolinkProtocol"), e.enter("autolinkMarker"), e.consume(x), e.exit("autolinkMarker"), e.exit("autolink"), r) : x === null || x === 32 || x === 60 || Tl(x) ? i(x) : (e.consume(x), p);
  }
  function h(x) {
    return x === 64 ? (e.consume(x), m) : qx(x) ? (e.consume(x), h) : i(x);
  }
  function m(x) {
    return wt(x) ? v(x) : i(x);
  }
  function v(x) {
    return x === 46 ? (e.consume(x), o = 0, m) : x === 62 ? (e.exit("autolinkProtocol").type = "autolinkEmail", e.enter("autolinkMarker"), e.consume(x), e.exit("autolinkMarker"), e.exit("autolink"), r) : w(x);
  }
  function w(x) {
    if ((x === 45 || wt(x)) && o++ < 63) {
      const E = x === 45 ? w : v;
      return e.consume(x), E;
    }
    return i(x);
  }
}
const ao = {
  partial: !0,
  tokenize: tk
};
function tk(e, r, i) {
  return o;
  function o(s) {
    return Pe(s) ? Oe(e, a, "linePrefix")(s) : a(s);
  }
  function a(s) {
    return s === null || Se(s) ? r(s) : i(s);
  }
}
const Th = {
  continuation: {
    tokenize: rk
  },
  exit: ik,
  name: "blockQuote",
  tokenize: nk
};
function nk(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    if (c === 62) {
      const d = o.containerState;
      return d.open || (e.enter("blockQuote", {
        _container: !0
      }), d.open = !0), e.enter("blockQuotePrefix"), e.enter("blockQuoteMarker"), e.consume(c), e.exit("blockQuoteMarker"), s;
    }
    return i(c);
  }
  function s(c) {
    return Pe(c) ? (e.enter("blockQuotePrefixWhitespace"), e.consume(c), e.exit("blockQuotePrefixWhitespace"), e.exit("blockQuotePrefix"), r) : (e.exit("blockQuotePrefix"), r(c));
  }
}
function rk(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return Pe(c) ? Oe(e, s, "linePrefix", o.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(c) : s(c);
  }
  function s(c) {
    return e.attempt(Th, r, i)(c);
  }
}
function ik(e) {
  e.exit("blockQuote");
}
const jh = {
  name: "characterEscape",
  tokenize: ok
};
function ok(e, r, i) {
  return o;
  function o(s) {
    return e.enter("characterEscape"), e.enter("escapeMarker"), e.consume(s), e.exit("escapeMarker"), a;
  }
  function a(s) {
    return Wx(s) ? (e.enter("characterEscapeValue"), e.consume(s), e.exit("characterEscapeValue"), e.exit("characterEscape"), r) : i(s);
  }
}
const Rh = {
  name: "characterReference",
  tokenize: lk
};
function lk(e, r, i) {
  const o = this;
  let a = 0, s, c;
  return d;
  function d(v) {
    return e.enter("characterReference"), e.enter("characterReferenceMarker"), e.consume(v), e.exit("characterReferenceMarker"), p;
  }
  function p(v) {
    return v === 35 ? (e.enter("characterReferenceMarkerNumeric"), e.consume(v), e.exit("characterReferenceMarkerNumeric"), h) : (e.enter("characterReferenceValue"), s = 31, c = wt, m(v));
  }
  function h(v) {
    return v === 88 || v === 120 ? (e.enter("characterReferenceMarkerHexadecimal"), e.consume(v), e.exit("characterReferenceMarkerHexadecimal"), e.enter("characterReferenceValue"), s = 6, c = Ux, m) : (e.enter("characterReferenceValue"), s = 7, c = iu, m(v));
  }
  function m(v) {
    if (v === 59 && a) {
      const w = e.exit("characterReferenceValue");
      return c === wt && !Nu(o.sliceSerialize(w)) ? i(v) : (e.enter("characterReferenceMarker"), e.consume(v), e.exit("characterReferenceMarker"), e.exit("characterReference"), r);
    }
    return c(v) && a++ < s ? (e.consume(v), m) : i(v);
  }
}
const up = {
  partial: !0,
  tokenize: sk
}, cp = {
  concrete: !0,
  name: "codeFenced",
  tokenize: ak
};
function ak(e, r, i) {
  const o = this, a = {
    partial: !0,
    tokenize: Z
  };
  let s = 0, c = 0, d;
  return p;
  function p(j) {
    return h(j);
  }
  function h(j) {
    const Y = o.events[o.events.length - 1];
    return s = Y && Y[1].type === "linePrefix" ? Y[2].sliceSerialize(Y[1], !0).length : 0, d = j, e.enter("codeFenced"), e.enter("codeFencedFence"), e.enter("codeFencedFenceSequence"), m(j);
  }
  function m(j) {
    return j === d ? (c++, e.consume(j), m) : c < 3 ? i(j) : (e.exit("codeFencedFenceSequence"), Pe(j) ? Oe(e, v, "whitespace")(j) : v(j));
  }
  function v(j) {
    return j === null || Se(j) ? (e.exit("codeFencedFence"), o.interrupt ? r(j) : e.check(up, L, ne)(j)) : (e.enter("codeFencedFenceInfo"), e.enter("chunkString", {
      contentType: "string"
    }), w(j));
  }
  function w(j) {
    return j === null || Se(j) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), v(j)) : Pe(j) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), Oe(e, x, "whitespace")(j)) : j === 96 && j === d ? i(j) : (e.consume(j), w);
  }
  function x(j) {
    return j === null || Se(j) ? v(j) : (e.enter("codeFencedFenceMeta"), e.enter("chunkString", {
      contentType: "string"
    }), E(j));
  }
  function E(j) {
    return j === null || Se(j) ? (e.exit("chunkString"), e.exit("codeFencedFenceMeta"), v(j)) : j === 96 && j === d ? i(j) : (e.consume(j), E);
  }
  function L(j) {
    return e.attempt(a, ne, D)(j);
  }
  function D(j) {
    return e.enter("lineEnding"), e.consume(j), e.exit("lineEnding"), z;
  }
  function z(j) {
    return s > 0 && Pe(j) ? Oe(e, U, "linePrefix", s + 1)(j) : U(j);
  }
  function U(j) {
    return j === null || Se(j) ? e.check(up, L, ne)(j) : (e.enter("codeFlowValue"), B(j));
  }
  function B(j) {
    return j === null || Se(j) ? (e.exit("codeFlowValue"), U(j)) : (e.consume(j), B);
  }
  function ne(j) {
    return e.exit("codeFenced"), r(j);
  }
  function Z(j, Y, se) {
    let re = 0;
    return I;
    function I(X) {
      return j.enter("lineEnding"), j.consume(X), j.exit("lineEnding"), te;
    }
    function te(X) {
      return j.enter("codeFencedFence"), Pe(X) ? Oe(j, ie, "linePrefix", o.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(X) : ie(X);
    }
    function ie(X) {
      return X === d ? (j.enter("codeFencedFenceSequence"), xe(X)) : se(X);
    }
    function xe(X) {
      return X === d ? (re++, j.consume(X), xe) : re >= c ? (j.exit("codeFencedFenceSequence"), Pe(X) ? Oe(j, oe, "whitespace")(X) : oe(X)) : se(X);
    }
    function oe(X) {
      return X === null || Se(X) ? (j.exit("codeFencedFence"), Y(X)) : se(X);
    }
  }
}
function sk(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return c === null ? i(c) : (e.enter("lineEnding"), e.consume(c), e.exit("lineEnding"), s);
  }
  function s(c) {
    return o.parser.lazy[o.now().line] ? i(c) : r(c);
  }
}
const zs = {
  name: "codeIndented",
  tokenize: ck
}, uk = {
  partial: !0,
  tokenize: dk
};
function ck(e, r, i) {
  const o = this;
  return a;
  function a(h) {
    return e.enter("codeIndented"), Oe(e, s, "linePrefix", 5)(h);
  }
  function s(h) {
    const m = o.events[o.events.length - 1];
    return m && m[1].type === "linePrefix" && m[2].sliceSerialize(m[1], !0).length >= 4 ? c(h) : i(h);
  }
  function c(h) {
    return h === null ? p(h) : Se(h) ? e.attempt(uk, c, p)(h) : (e.enter("codeFlowValue"), d(h));
  }
  function d(h) {
    return h === null || Se(h) ? (e.exit("codeFlowValue"), c(h)) : (e.consume(h), d);
  }
  function p(h) {
    return e.exit("codeIndented"), r(h);
  }
}
function dk(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return o.parser.lazy[o.now().line] ? i(c) : Se(c) ? (e.enter("lineEnding"), e.consume(c), e.exit("lineEnding"), a) : Oe(e, s, "linePrefix", 5)(c);
  }
  function s(c) {
    const d = o.events[o.events.length - 1];
    return d && d[1].type === "linePrefix" && d[2].sliceSerialize(d[1], !0).length >= 4 ? r(c) : Se(c) ? a(c) : i(c);
  }
}
const fk = {
  name: "codeText",
  previous: hk,
  resolve: pk,
  tokenize: mk
};
function pk(e) {
  let r = e.length - 4, i = 3, o, a;
  if ((e[i][1].type === "lineEnding" || e[i][1].type === "space") && (e[r][1].type === "lineEnding" || e[r][1].type === "space")) {
    for (o = i; ++o < r; )
      if (e[o][1].type === "codeTextData") {
        e[i][1].type = "codeTextPadding", e[r][1].type = "codeTextPadding", i += 2, r -= 2;
        break;
      }
  }
  for (o = i - 1, r++; ++o <= r; )
    a === void 0 ? o !== r && e[o][1].type !== "lineEnding" && (a = o) : (o === r || e[o][1].type === "lineEnding") && (e[a][1].type = "codeTextData", o !== a + 2 && (e[a][1].end = e[o - 1][1].end, e.splice(a + 2, o - a - 2), r -= o - a - 2, o = a + 2), a = void 0);
  return e;
}
function hk(e) {
  return e !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
function mk(e, r, i) {
  let o = 0, a, s;
  return c;
  function c(v) {
    return e.enter("codeText"), e.enter("codeTextSequence"), d(v);
  }
  function d(v) {
    return v === 96 ? (e.consume(v), o++, d) : (e.exit("codeTextSequence"), p(v));
  }
  function p(v) {
    return v === null ? i(v) : v === 32 ? (e.enter("space"), e.consume(v), e.exit("space"), p) : v === 96 ? (s = e.enter("codeTextSequence"), a = 0, m(v)) : Se(v) ? (e.enter("lineEnding"), e.consume(v), e.exit("lineEnding"), p) : (e.enter("codeTextData"), h(v));
  }
  function h(v) {
    return v === null || v === 32 || v === 96 || Se(v) ? (e.exit("codeTextData"), p(v)) : (e.consume(v), h);
  }
  function m(v) {
    return v === 96 ? (e.consume(v), a++, m) : a === o ? (e.exit("codeTextSequence"), e.exit("codeText"), r(v)) : (s.type = "codeTextData", h(v));
  }
}
class gk {
  /**
   * @param {ReadonlyArray<T> | null | undefined} [initial]
   *   Initial items (optional).
   * @returns
   *   Splice buffer.
   */
  constructor(r) {
    this.left = r ? [...r] : [], this.right = [];
  }
  /**
   * Array access;
   * does not move the cursor.
   *
   * @param {number} index
   *   Index.
   * @return {T}
   *   Item.
   */
  get(r) {
    if (r < 0 || r >= this.left.length + this.right.length)
      throw new RangeError("Cannot access index `" + r + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
    return r < this.left.length ? this.left[r] : this.right[this.right.length - r + this.left.length - 1];
  }
  /**
   * The length of the splice buffer, one greater than the largest index in the
   * array.
   */
  get length() {
    return this.left.length + this.right.length;
  }
  /**
   * Remove and return `list[0]`;
   * moves the cursor to `0`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  shift() {
    return this.setCursor(0), this.right.pop();
  }
  /**
   * Slice the buffer to get an array;
   * does not move the cursor.
   *
   * @param {number} start
   *   Start.
   * @param {number | null | undefined} [end]
   *   End (optional).
   * @returns {Array<T>}
   *   Array of items.
   */
  slice(r, i) {
    const o = i ?? Number.POSITIVE_INFINITY;
    return o < this.left.length ? this.left.slice(r, o) : r > this.left.length ? this.right.slice(this.right.length - o + this.left.length, this.right.length - r + this.left.length).reverse() : this.left.slice(r).concat(this.right.slice(this.right.length - o + this.left.length).reverse());
  }
  /**
   * Mimics the behavior of Array.prototype.splice() except for the change of
   * interface necessary to avoid segfaults when patching in very large arrays.
   *
   * This operation moves cursor is moved to `start` and results in the cursor
   * placed after any inserted items.
   *
   * @param {number} start
   *   Start;
   *   zero-based index at which to start changing the array;
   *   negative numbers count backwards from the end of the array and values
   *   that are out-of bounds are clamped to the appropriate end of the array.
   * @param {number | null | undefined} [deleteCount=0]
   *   Delete count (default: `0`);
   *   maximum number of elements to delete, starting from start.
   * @param {Array<T> | null | undefined} [items=[]]
   *   Items to include in place of the deleted items (default: `[]`).
   * @return {Array<T>}
   *   Any removed items.
   */
  splice(r, i, o) {
    const a = i || 0;
    this.setCursor(Math.trunc(r));
    const s = this.right.splice(this.right.length - a, Number.POSITIVE_INFINITY);
    return o && Vi(this.left, o), s.reverse();
  }
  /**
   * Remove and return the highest-numbered item in the array, so
   * `list[list.length - 1]`;
   * Moves the cursor to `length`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  pop() {
    return this.setCursor(Number.POSITIVE_INFINITY), this.left.pop();
  }
  /**
   * Inserts a single item to the high-numbered side of the array;
   * moves the cursor to `length`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  push(r) {
    this.setCursor(Number.POSITIVE_INFINITY), this.left.push(r);
  }
  /**
   * Inserts many items to the high-numbered side of the array.
   * Moves the cursor to `length`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  pushMany(r) {
    this.setCursor(Number.POSITIVE_INFINITY), Vi(this.left, r);
  }
  /**
   * Inserts a single item to the low-numbered side of the array;
   * Moves the cursor to `0`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  unshift(r) {
    this.setCursor(0), this.right.push(r);
  }
  /**
   * Inserts many items to the low-numbered side of the array;
   * moves the cursor to `0`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  unshiftMany(r) {
    this.setCursor(0), Vi(this.right, r.reverse());
  }
  /**
   * Move the cursor to a specific position in the array. Requires
   * time proportional to the distance moved.
   *
   * If `n < 0`, the cursor will end up at the beginning.
   * If `n > length`, the cursor will end up at the end.
   *
   * @param {number} n
   *   Position.
   * @return {undefined}
   *   Nothing.
   */
  setCursor(r) {
    if (!(r === this.left.length || r > this.left.length && this.right.length === 0 || r < 0 && this.left.length === 0))
      if (r < this.left.length) {
        const i = this.left.splice(r, Number.POSITIVE_INFINITY);
        Vi(this.right, i.reverse());
      } else {
        const i = this.right.splice(this.left.length + this.right.length - r, Number.POSITIVE_INFINITY);
        Vi(this.left, i.reverse());
      }
  }
}
function Vi(e, r) {
  let i = 0;
  if (r.length < 1e4)
    e.push(...r);
  else
    for (; i < r.length; )
      e.push(...r.slice(i, i + 1e4)), i += 1e4;
}
function Lh(e) {
  const r = {};
  let i = -1, o, a, s, c, d, p, h;
  const m = new gk(e);
  for (; ++i < m.length; ) {
    for (; i in r; )
      i = r[i];
    if (o = m.get(i), i && o[1].type === "chunkFlow" && m.get(i - 1)[1].type === "listItemPrefix" && (p = o[1]._tokenizer.events, s = 0, s < p.length && p[s][1].type === "lineEndingBlank" && (s += 2), s < p.length && p[s][1].type === "content"))
      for (; ++s < p.length && p[s][1].type !== "content"; )
        p[s][1].type === "chunkText" && (p[s][1]._isInFirstContentOfListItem = !0, s++);
    if (o[0] === "enter")
      o[1].contentType && (Object.assign(r, yk(m, i)), i = r[i], h = !0);
    else if (o[1]._container) {
      for (s = i, a = void 0; s--; )
        if (c = m.get(s), c[1].type === "lineEnding" || c[1].type === "lineEndingBlank")
          c[0] === "enter" && (a && (m.get(a)[1].type = "lineEndingBlank"), c[1].type = "lineEnding", a = s);
        else if (!(c[1].type === "linePrefix" || c[1].type === "listItemIndent")) break;
      a && (o[1].end = {
        ...m.get(a)[1].start
      }, d = m.slice(a, i), d.unshift(o), m.splice(a, i - a + 1, d));
    }
  }
  return $t(e, 0, Number.POSITIVE_INFINITY, m.slice(0)), !h;
}
function yk(e, r) {
  const i = e.get(r)[1], o = e.get(r)[2];
  let a = r - 1;
  const s = [];
  let c = i._tokenizer;
  c || (c = o.parser[i.contentType](i.start), i._contentTypeTextTrailing && (c._contentTypeTextTrailing = !0));
  const d = c.events, p = [], h = {};
  let m, v, w = -1, x = i, E = 0, L = 0;
  const D = [L];
  for (; x; ) {
    for (; e.get(++a)[1] !== x; )
      ;
    s.push(a), x._tokenizer || (m = o.sliceStream(x), x.next || m.push(null), v && c.defineSkip(x.start), x._isInFirstContentOfListItem && (c._gfmTasklistFirstContentOfListItem = !0), c.write(m), x._isInFirstContentOfListItem && (c._gfmTasklistFirstContentOfListItem = void 0)), v = x, x = x.next;
  }
  for (x = i; ++w < d.length; )
    // Find a void token that includes a break.
    d[w][0] === "exit" && d[w - 1][0] === "enter" && d[w][1].type === d[w - 1][1].type && d[w][1].start.line !== d[w][1].end.line && (L = w + 1, D.push(L), x._tokenizer = void 0, x.previous = void 0, x = x.next);
  for (c.events = [], x ? (x._tokenizer = void 0, x.previous = void 0) : D.pop(), w = D.length; w--; ) {
    const z = d.slice(D[w], D[w + 1]), U = s.pop();
    p.push([U, U + z.length - 1]), e.splice(U, 2, z);
  }
  for (p.reverse(), w = -1; ++w < p.length; )
    h[E + p[w][0]] = E + p[w][1], E += p[w][1] - p[w][0] - 1;
  return h;
}
const vk = {
  resolve: kk,
  tokenize: wk
}, xk = {
  partial: !0,
  tokenize: bk
};
function kk(e) {
  return Lh(e), e;
}
function wk(e, r) {
  let i;
  return o;
  function o(d) {
    return e.enter("content"), i = e.enter("chunkContent", {
      contentType: "content"
    }), a(d);
  }
  function a(d) {
    return d === null ? s(d) : Se(d) ? e.check(xk, c, s)(d) : (e.consume(d), a);
  }
  function s(d) {
    return e.exit("chunkContent"), e.exit("content"), r(d);
  }
  function c(d) {
    return e.consume(d), e.exit("chunkContent"), i.next = e.enter("chunkContent", {
      contentType: "content",
      previous: i
    }), i = i.next, a;
  }
}
function bk(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return e.exit("chunkContent"), e.enter("lineEnding"), e.consume(c), e.exit("lineEnding"), Oe(e, s, "linePrefix");
  }
  function s(c) {
    if (c === null || Se(c))
      return i(c);
    const d = o.events[o.events.length - 1];
    return !o.parser.constructs.disable.null.includes("codeIndented") && d && d[1].type === "linePrefix" && d[2].sliceSerialize(d[1], !0).length >= 4 ? r(c) : e.interrupt(o.parser.constructs.flow, i, r)(c);
  }
}
function Nh(e, r, i, o, a, s, c, d, p) {
  const h = p || Number.POSITIVE_INFINITY;
  let m = 0;
  return v;
  function v(z) {
    return z === 60 ? (e.enter(o), e.enter(a), e.enter(s), e.consume(z), e.exit(s), w) : z === null || z === 32 || z === 41 || Tl(z) ? i(z) : (e.enter(o), e.enter(c), e.enter(d), e.enter("chunkString", {
      contentType: "string"
    }), L(z));
  }
  function w(z) {
    return z === 62 ? (e.enter(s), e.consume(z), e.exit(s), e.exit(a), e.exit(o), r) : (e.enter(d), e.enter("chunkString", {
      contentType: "string"
    }), x(z));
  }
  function x(z) {
    return z === 62 ? (e.exit("chunkString"), e.exit(d), w(z)) : z === null || z === 60 || Se(z) ? i(z) : (e.consume(z), z === 92 ? E : x);
  }
  function E(z) {
    return z === 60 || z === 62 || z === 92 ? (e.consume(z), x) : x(z);
  }
  function L(z) {
    return !m && (z === null || z === 41 || Ge(z)) ? (e.exit("chunkString"), e.exit(d), e.exit(c), e.exit(o), r(z)) : m < h && z === 40 ? (e.consume(z), m++, L) : z === 41 ? (e.consume(z), m--, L) : z === null || z === 32 || z === 40 || Tl(z) ? i(z) : (e.consume(z), z === 92 ? D : L);
  }
  function D(z) {
    return z === 40 || z === 41 || z === 92 ? (e.consume(z), L) : L(z);
  }
}
function Ah(e, r, i, o, a, s) {
  const c = this;
  let d = 0, p;
  return h;
  function h(x) {
    return e.enter(o), e.enter(a), e.consume(x), e.exit(a), e.enter(s), m;
  }
  function m(x) {
    return d > 999 || x === null || x === 91 || x === 93 && !p || // To do: remove in the future once we’ve switched from
    // `micromark-extension-footnote` to `micromark-extension-gfm-footnote`,
    // which doesn’t need this.
    // Hidden footnotes hook.
    /* c8 ignore next 3 */
    x === 94 && !d && "_hiddenFootnoteSupport" in c.parser.constructs ? i(x) : x === 93 ? (e.exit(s), e.enter(a), e.consume(x), e.exit(a), e.exit(o), r) : Se(x) ? (e.enter("lineEnding"), e.consume(x), e.exit("lineEnding"), m) : (e.enter("chunkString", {
      contentType: "string"
    }), v(x));
  }
  function v(x) {
    return x === null || x === 91 || x === 93 || Se(x) || d++ > 999 ? (e.exit("chunkString"), m(x)) : (e.consume(x), p || (p = !Pe(x)), x === 92 ? w : v);
  }
  function w(x) {
    return x === 91 || x === 92 || x === 93 ? (e.consume(x), d++, v) : v(x);
  }
}
function zh(e, r, i, o, a, s) {
  let c;
  return d;
  function d(w) {
    return w === 34 || w === 39 || w === 40 ? (e.enter(o), e.enter(a), e.consume(w), e.exit(a), c = w === 40 ? 41 : w, p) : i(w);
  }
  function p(w) {
    return w === c ? (e.enter(a), e.consume(w), e.exit(a), e.exit(o), r) : (e.enter(s), h(w));
  }
  function h(w) {
    return w === c ? (e.exit(s), p(c)) : w === null ? i(w) : Se(w) ? (e.enter("lineEnding"), e.consume(w), e.exit("lineEnding"), Oe(e, h, "linePrefix")) : (e.enter("chunkString", {
      contentType: "string"
    }), m(w));
  }
  function m(w) {
    return w === c || w === null || Se(w) ? (e.exit("chunkString"), h(w)) : (e.consume(w), w === 92 ? v : m);
  }
  function v(w) {
    return w === c || w === 92 ? (e.consume(w), m) : m(w);
  }
}
function Xi(e, r) {
  let i;
  return o;
  function o(a) {
    return Se(a) ? (e.enter("lineEnding"), e.consume(a), e.exit("lineEnding"), i = !0, o) : Pe(a) ? Oe(e, o, i ? "linePrefix" : "lineSuffix")(a) : r(a);
  }
}
const Sk = {
  name: "definition",
  tokenize: Ek
}, Ck = {
  partial: !0,
  tokenize: _k
};
function Ek(e, r, i) {
  const o = this;
  let a;
  return s;
  function s(x) {
    return e.enter("definition"), c(x);
  }
  function c(x) {
    return Ah.call(
      o,
      e,
      d,
      // Note: we don’t need to reset the way `markdown-rs` does.
      i,
      "definitionLabel",
      "definitionLabelMarker",
      "definitionLabelString"
    )(x);
  }
  function d(x) {
    return a = an(o.sliceSerialize(o.events[o.events.length - 1][1]).slice(1, -1)), x === 58 ? (e.enter("definitionMarker"), e.consume(x), e.exit("definitionMarker"), p) : i(x);
  }
  function p(x) {
    return Ge(x) ? Xi(e, h)(x) : h(x);
  }
  function h(x) {
    return Nh(
      e,
      m,
      // Note: we don’t need to reset the way `markdown-rs` does.
      i,
      "definitionDestination",
      "definitionDestinationLiteral",
      "definitionDestinationLiteralMarker",
      "definitionDestinationRaw",
      "definitionDestinationString"
    )(x);
  }
  function m(x) {
    return e.attempt(Ck, v, v)(x);
  }
  function v(x) {
    return Pe(x) ? Oe(e, w, "whitespace")(x) : w(x);
  }
  function w(x) {
    return x === null || Se(x) ? (e.exit("definition"), o.parser.defined.push(a), r(x)) : i(x);
  }
}
function _k(e, r, i) {
  return o;
  function o(d) {
    return Ge(d) ? Xi(e, a)(d) : i(d);
  }
  function a(d) {
    return zh(e, s, i, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(d);
  }
  function s(d) {
    return Pe(d) ? Oe(e, c, "whitespace")(d) : c(d);
  }
  function c(d) {
    return d === null || Se(d) ? r(d) : i(d);
  }
}
const Tk = {
  name: "hardBreakEscape",
  tokenize: jk
};
function jk(e, r, i) {
  return o;
  function o(s) {
    return e.enter("hardBreakEscape"), e.consume(s), a;
  }
  function a(s) {
    return Se(s) ? (e.exit("hardBreakEscape"), r(s)) : i(s);
  }
}
const Rk = {
  name: "headingAtx",
  resolve: Lk,
  tokenize: Nk
};
function Lk(e, r) {
  let i = e.length - 2, o = 3, a, s;
  return e[o][1].type === "whitespace" && (o += 2), i - 2 > o && e[i][1].type === "whitespace" && (i -= 2), e[i][1].type === "atxHeadingSequence" && (o === i - 1 || i - 4 > o && e[i - 2][1].type === "whitespace") && (i -= o + 1 === i ? 2 : 4), i > o && (a = {
    type: "atxHeadingText",
    start: e[o][1].start,
    end: e[i][1].end
  }, s = {
    type: "chunkText",
    start: e[o][1].start,
    end: e[i][1].end,
    contentType: "text"
  }, $t(e, o, i - o + 1, [["enter", a, r], ["enter", s, r], ["exit", s, r], ["exit", a, r]])), e;
}
function Nk(e, r, i) {
  let o = 0;
  return a;
  function a(m) {
    return e.enter("atxHeading"), s(m);
  }
  function s(m) {
    return e.enter("atxHeadingSequence"), c(m);
  }
  function c(m) {
    return m === 35 && o++ < 6 ? (e.consume(m), c) : m === null || Ge(m) ? (e.exit("atxHeadingSequence"), d(m)) : i(m);
  }
  function d(m) {
    return m === 35 ? (e.enter("atxHeadingSequence"), p(m)) : m === null || Se(m) ? (e.exit("atxHeading"), r(m)) : Pe(m) ? Oe(e, d, "whitespace")(m) : (e.enter("atxHeadingText"), h(m));
  }
  function p(m) {
    return m === 35 ? (e.consume(m), p) : (e.exit("atxHeadingSequence"), d(m));
  }
  function h(m) {
    return m === null || m === 35 || Ge(m) ? (e.exit("atxHeadingText"), d(m)) : (e.consume(m), h);
  }
}
const Ak = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul"
], dp = ["pre", "script", "style", "textarea"], zk = {
  concrete: !0,
  name: "htmlFlow",
  resolveTo: Dk,
  tokenize: Mk
}, Pk = {
  partial: !0,
  tokenize: Fk
}, Ik = {
  partial: !0,
  tokenize: Ok
};
function Dk(e) {
  let r = e.length;
  for (; r-- && !(e[r][0] === "enter" && e[r][1].type === "htmlFlow"); )
    ;
  return r > 1 && e[r - 2][1].type === "linePrefix" && (e[r][1].start = e[r - 2][1].start, e[r + 1][1].start = e[r - 2][1].start, e.splice(r - 2, 2)), e;
}
function Mk(e, r, i) {
  const o = this;
  let a, s, c, d, p;
  return h;
  function h(S) {
    return m(S);
  }
  function m(S) {
    return e.enter("htmlFlow"), e.enter("htmlFlowData"), e.consume(S), v;
  }
  function v(S) {
    return S === 33 ? (e.consume(S), w) : S === 47 ? (e.consume(S), s = !0, L) : S === 63 ? (e.consume(S), a = 3, o.interrupt ? r : b) : _t(S) ? (e.consume(S), c = String.fromCharCode(S), D) : i(S);
  }
  function w(S) {
    return S === 45 ? (e.consume(S), a = 2, x) : S === 91 ? (e.consume(S), a = 5, d = 0, E) : _t(S) ? (e.consume(S), a = 4, o.interrupt ? r : b) : i(S);
  }
  function x(S) {
    return S === 45 ? (e.consume(S), o.interrupt ? r : b) : i(S);
  }
  function E(S) {
    const le = "CDATA[";
    return S === le.charCodeAt(d++) ? (e.consume(S), d === le.length ? o.interrupt ? r : ie : E) : i(S);
  }
  function L(S) {
    return _t(S) ? (e.consume(S), c = String.fromCharCode(S), D) : i(S);
  }
  function D(S) {
    if (S === null || S === 47 || S === 62 || Ge(S)) {
      const le = S === 47, ye = c.toLowerCase();
      return !le && !s && dp.includes(ye) ? (a = 1, o.interrupt ? r(S) : ie(S)) : Ak.includes(c.toLowerCase()) ? (a = 6, le ? (e.consume(S), z) : o.interrupt ? r(S) : ie(S)) : (a = 7, o.interrupt && !o.parser.lazy[o.now().line] ? i(S) : s ? U(S) : B(S));
    }
    return S === 45 || wt(S) ? (e.consume(S), c += String.fromCharCode(S), D) : i(S);
  }
  function z(S) {
    return S === 62 ? (e.consume(S), o.interrupt ? r : ie) : i(S);
  }
  function U(S) {
    return Pe(S) ? (e.consume(S), U) : I(S);
  }
  function B(S) {
    return S === 47 ? (e.consume(S), I) : S === 58 || S === 95 || _t(S) ? (e.consume(S), ne) : Pe(S) ? (e.consume(S), B) : I(S);
  }
  function ne(S) {
    return S === 45 || S === 46 || S === 58 || S === 95 || wt(S) ? (e.consume(S), ne) : Z(S);
  }
  function Z(S) {
    return S === 61 ? (e.consume(S), j) : Pe(S) ? (e.consume(S), Z) : B(S);
  }
  function j(S) {
    return S === null || S === 60 || S === 61 || S === 62 || S === 96 ? i(S) : S === 34 || S === 39 ? (e.consume(S), p = S, Y) : Pe(S) ? (e.consume(S), j) : se(S);
  }
  function Y(S) {
    return S === p ? (e.consume(S), p = null, re) : S === null || Se(S) ? i(S) : (e.consume(S), Y);
  }
  function se(S) {
    return S === null || S === 34 || S === 39 || S === 47 || S === 60 || S === 61 || S === 62 || S === 96 || Ge(S) ? Z(S) : (e.consume(S), se);
  }
  function re(S) {
    return S === 47 || S === 62 || Pe(S) ? B(S) : i(S);
  }
  function I(S) {
    return S === 62 ? (e.consume(S), te) : i(S);
  }
  function te(S) {
    return S === null || Se(S) ? ie(S) : Pe(S) ? (e.consume(S), te) : i(S);
  }
  function ie(S) {
    return S === 45 && a === 2 ? (e.consume(S), ge) : S === 60 && a === 1 ? (e.consume(S), Ce) : S === 62 && a === 4 ? (e.consume(S), _) : S === 63 && a === 3 ? (e.consume(S), b) : S === 93 && a === 5 ? (e.consume(S), N) : Se(S) && (a === 6 || a === 7) ? (e.exit("htmlFlowData"), e.check(Pk, O, xe)(S)) : S === null || Se(S) ? (e.exit("htmlFlowData"), xe(S)) : (e.consume(S), ie);
  }
  function xe(S) {
    return e.check(Ik, oe, O)(S);
  }
  function oe(S) {
    return e.enter("lineEnding"), e.consume(S), e.exit("lineEnding"), X;
  }
  function X(S) {
    return S === null || Se(S) ? xe(S) : (e.enter("htmlFlowData"), ie(S));
  }
  function ge(S) {
    return S === 45 ? (e.consume(S), b) : ie(S);
  }
  function Ce(S) {
    return S === 47 ? (e.consume(S), c = "", q) : ie(S);
  }
  function q(S) {
    if (S === 62) {
      const le = c.toLowerCase();
      return dp.includes(le) ? (e.consume(S), _) : ie(S);
    }
    return _t(S) && c.length < 8 ? (e.consume(S), c += String.fromCharCode(S), q) : ie(S);
  }
  function N(S) {
    return S === 93 ? (e.consume(S), b) : ie(S);
  }
  function b(S) {
    return S === 62 ? (e.consume(S), _) : S === 45 && a === 2 ? (e.consume(S), b) : ie(S);
  }
  function _(S) {
    return S === null || Se(S) ? (e.exit("htmlFlowData"), O(S)) : (e.consume(S), _);
  }
  function O(S) {
    return e.exit("htmlFlow"), r(S);
  }
}
function Ok(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return Se(c) ? (e.enter("lineEnding"), e.consume(c), e.exit("lineEnding"), s) : i(c);
  }
  function s(c) {
    return o.parser.lazy[o.now().line] ? i(c) : r(c);
  }
}
function Fk(e, r, i) {
  return o;
  function o(a) {
    return e.enter("lineEnding"), e.consume(a), e.exit("lineEnding"), e.attempt(ao, r, i);
  }
}
const $k = {
  name: "htmlText",
  tokenize: Bk
};
function Bk(e, r, i) {
  const o = this;
  let a, s, c;
  return d;
  function d(b) {
    return e.enter("htmlText"), e.enter("htmlTextData"), e.consume(b), p;
  }
  function p(b) {
    return b === 33 ? (e.consume(b), h) : b === 47 ? (e.consume(b), Z) : b === 63 ? (e.consume(b), B) : _t(b) ? (e.consume(b), se) : i(b);
  }
  function h(b) {
    return b === 45 ? (e.consume(b), m) : b === 91 ? (e.consume(b), s = 0, E) : _t(b) ? (e.consume(b), U) : i(b);
  }
  function m(b) {
    return b === 45 ? (e.consume(b), x) : i(b);
  }
  function v(b) {
    return b === null ? i(b) : b === 45 ? (e.consume(b), w) : Se(b) ? (c = v, Ce(b)) : (e.consume(b), v);
  }
  function w(b) {
    return b === 45 ? (e.consume(b), x) : v(b);
  }
  function x(b) {
    return b === 62 ? ge(b) : b === 45 ? w(b) : v(b);
  }
  function E(b) {
    const _ = "CDATA[";
    return b === _.charCodeAt(s++) ? (e.consume(b), s === _.length ? L : E) : i(b);
  }
  function L(b) {
    return b === null ? i(b) : b === 93 ? (e.consume(b), D) : Se(b) ? (c = L, Ce(b)) : (e.consume(b), L);
  }
  function D(b) {
    return b === 93 ? (e.consume(b), z) : L(b);
  }
  function z(b) {
    return b === 62 ? ge(b) : b === 93 ? (e.consume(b), z) : L(b);
  }
  function U(b) {
    return b === null || b === 62 ? ge(b) : Se(b) ? (c = U, Ce(b)) : (e.consume(b), U);
  }
  function B(b) {
    return b === null ? i(b) : b === 63 ? (e.consume(b), ne) : Se(b) ? (c = B, Ce(b)) : (e.consume(b), B);
  }
  function ne(b) {
    return b === 62 ? ge(b) : B(b);
  }
  function Z(b) {
    return _t(b) ? (e.consume(b), j) : i(b);
  }
  function j(b) {
    return b === 45 || wt(b) ? (e.consume(b), j) : Y(b);
  }
  function Y(b) {
    return Se(b) ? (c = Y, Ce(b)) : Pe(b) ? (e.consume(b), Y) : ge(b);
  }
  function se(b) {
    return b === 45 || wt(b) ? (e.consume(b), se) : b === 47 || b === 62 || Ge(b) ? re(b) : i(b);
  }
  function re(b) {
    return b === 47 ? (e.consume(b), ge) : b === 58 || b === 95 || _t(b) ? (e.consume(b), I) : Se(b) ? (c = re, Ce(b)) : Pe(b) ? (e.consume(b), re) : ge(b);
  }
  function I(b) {
    return b === 45 || b === 46 || b === 58 || b === 95 || wt(b) ? (e.consume(b), I) : te(b);
  }
  function te(b) {
    return b === 61 ? (e.consume(b), ie) : Se(b) ? (c = te, Ce(b)) : Pe(b) ? (e.consume(b), te) : re(b);
  }
  function ie(b) {
    return b === null || b === 60 || b === 61 || b === 62 || b === 96 ? i(b) : b === 34 || b === 39 ? (e.consume(b), a = b, xe) : Se(b) ? (c = ie, Ce(b)) : Pe(b) ? (e.consume(b), ie) : (e.consume(b), oe);
  }
  function xe(b) {
    return b === a ? (e.consume(b), a = void 0, X) : b === null ? i(b) : Se(b) ? (c = xe, Ce(b)) : (e.consume(b), xe);
  }
  function oe(b) {
    return b === null || b === 34 || b === 39 || b === 60 || b === 61 || b === 96 ? i(b) : b === 47 || b === 62 || Ge(b) ? re(b) : (e.consume(b), oe);
  }
  function X(b) {
    return b === 47 || b === 62 || Ge(b) ? re(b) : i(b);
  }
  function ge(b) {
    return b === 62 ? (e.consume(b), e.exit("htmlTextData"), e.exit("htmlText"), r) : i(b);
  }
  function Ce(b) {
    return e.exit("htmlTextData"), e.enter("lineEnding"), e.consume(b), e.exit("lineEnding"), q;
  }
  function q(b) {
    return Pe(b) ? Oe(e, N, "linePrefix", o.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(b) : N(b);
  }
  function N(b) {
    return e.enter("htmlTextData"), c(b);
  }
}
const Au = {
  name: "labelEnd",
  resolveAll: Wk,
  resolveTo: Vk,
  tokenize: Gk
}, Hk = {
  tokenize: Qk
}, qk = {
  tokenize: Kk
}, Uk = {
  tokenize: Yk
};
function Wk(e) {
  let r = -1;
  const i = [];
  for (; ++r < e.length; ) {
    const o = e[r][1];
    if (i.push(e[r]), o.type === "labelImage" || o.type === "labelLink" || o.type === "labelEnd") {
      const a = o.type === "labelImage" ? 4 : 2;
      o.type = "data", r += a;
    }
  }
  return e.length !== i.length && $t(e, 0, e.length, i), e;
}
function Vk(e, r) {
  let i = e.length, o = 0, a, s, c, d;
  for (; i--; )
    if (a = e[i][1], s) {
      if (a.type === "link" || a.type === "labelLink" && a._inactive)
        break;
      e[i][0] === "enter" && a.type === "labelLink" && (a._inactive = !0);
    } else if (c) {
      if (e[i][0] === "enter" && (a.type === "labelImage" || a.type === "labelLink") && !a._balanced && (s = i, a.type !== "labelLink")) {
        o = 2;
        break;
      }
    } else a.type === "labelEnd" && (c = i);
  const p = {
    type: e[s][1].type === "labelLink" ? "link" : "image",
    start: {
      ...e[s][1].start
    },
    end: {
      ...e[e.length - 1][1].end
    }
  }, h = {
    type: "label",
    start: {
      ...e[s][1].start
    },
    end: {
      ...e[c][1].end
    }
  }, m = {
    type: "labelText",
    start: {
      ...e[s + o + 2][1].end
    },
    end: {
      ...e[c - 2][1].start
    }
  };
  return d = [["enter", p, r], ["enter", h, r]], d = Kt(d, e.slice(s + 1, s + o + 3)), d = Kt(d, [["enter", m, r]]), d = Kt(d, Dl(r.parser.constructs.insideSpan.null, e.slice(s + o + 4, c - 3), r)), d = Kt(d, [["exit", m, r], e[c - 2], e[c - 1], ["exit", h, r]]), d = Kt(d, e.slice(c + 1)), d = Kt(d, [["exit", p, r]]), $t(e, s, e.length, d), e;
}
function Gk(e, r, i) {
  const o = this;
  let a = o.events.length, s, c;
  for (; a--; )
    if ((o.events[a][1].type === "labelImage" || o.events[a][1].type === "labelLink") && !o.events[a][1]._balanced) {
      s = o.events[a][1];
      break;
    }
  return d;
  function d(w) {
    return s ? s._inactive ? v(w) : (c = o.parser.defined.includes(an(o.sliceSerialize({
      start: s.end,
      end: o.now()
    }))), e.enter("labelEnd"), e.enter("labelMarker"), e.consume(w), e.exit("labelMarker"), e.exit("labelEnd"), p) : i(w);
  }
  function p(w) {
    return w === 40 ? e.attempt(Hk, m, c ? m : v)(w) : w === 91 ? e.attempt(qk, m, c ? h : v)(w) : c ? m(w) : v(w);
  }
  function h(w) {
    return e.attempt(Uk, m, v)(w);
  }
  function m(w) {
    return r(w);
  }
  function v(w) {
    return s._balanced = !0, i(w);
  }
}
function Qk(e, r, i) {
  return o;
  function o(v) {
    return e.enter("resource"), e.enter("resourceMarker"), e.consume(v), e.exit("resourceMarker"), a;
  }
  function a(v) {
    return Ge(v) ? Xi(e, s)(v) : s(v);
  }
  function s(v) {
    return v === 41 ? m(v) : Nh(e, c, d, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(v);
  }
  function c(v) {
    return Ge(v) ? Xi(e, p)(v) : m(v);
  }
  function d(v) {
    return i(v);
  }
  function p(v) {
    return v === 34 || v === 39 || v === 40 ? zh(e, h, i, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(v) : m(v);
  }
  function h(v) {
    return Ge(v) ? Xi(e, m)(v) : m(v);
  }
  function m(v) {
    return v === 41 ? (e.enter("resourceMarker"), e.consume(v), e.exit("resourceMarker"), e.exit("resource"), r) : i(v);
  }
}
function Kk(e, r, i) {
  const o = this;
  return a;
  function a(d) {
    return Ah.call(o, e, s, c, "reference", "referenceMarker", "referenceString")(d);
  }
  function s(d) {
    return o.parser.defined.includes(an(o.sliceSerialize(o.events[o.events.length - 1][1]).slice(1, -1))) ? r(d) : i(d);
  }
  function c(d) {
    return i(d);
  }
}
function Yk(e, r, i) {
  return o;
  function o(s) {
    return e.enter("reference"), e.enter("referenceMarker"), e.consume(s), e.exit("referenceMarker"), a;
  }
  function a(s) {
    return s === 93 ? (e.enter("referenceMarker"), e.consume(s), e.exit("referenceMarker"), e.exit("reference"), r) : i(s);
  }
}
const Xk = {
  name: "labelStartImage",
  resolveAll: Au.resolveAll,
  tokenize: Jk
};
function Jk(e, r, i) {
  const o = this;
  return a;
  function a(d) {
    return e.enter("labelImage"), e.enter("labelImageMarker"), e.consume(d), e.exit("labelImageMarker"), s;
  }
  function s(d) {
    return d === 91 ? (e.enter("labelMarker"), e.consume(d), e.exit("labelMarker"), e.exit("labelImage"), c) : i(d);
  }
  function c(d) {
    return d === 94 && "_hiddenFootnoteSupport" in o.parser.constructs ? i(d) : r(d);
  }
}
const Zk = {
  name: "labelStartLink",
  resolveAll: Au.resolveAll,
  tokenize: ew
};
function ew(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return e.enter("labelLink"), e.enter("labelMarker"), e.consume(c), e.exit("labelMarker"), e.exit("labelLink"), s;
  }
  function s(c) {
    return c === 94 && "_hiddenFootnoteSupport" in o.parser.constructs ? i(c) : r(c);
  }
}
const Ps = {
  name: "lineEnding",
  tokenize: tw
};
function tw(e, r) {
  return i;
  function i(o) {
    return e.enter("lineEnding"), e.consume(o), e.exit("lineEnding"), Oe(e, r, "linePrefix");
  }
}
const _l = {
  name: "thematicBreak",
  tokenize: nw
};
function nw(e, r, i) {
  let o = 0, a;
  return s;
  function s(h) {
    return e.enter("thematicBreak"), c(h);
  }
  function c(h) {
    return a = h, d(h);
  }
  function d(h) {
    return h === a ? (e.enter("thematicBreakSequence"), p(h)) : o >= 3 && (h === null || Se(h)) ? (e.exit("thematicBreak"), r(h)) : i(h);
  }
  function p(h) {
    return h === a ? (e.consume(h), o++, p) : (e.exit("thematicBreakSequence"), Pe(h) ? Oe(e, d, "whitespace")(h) : d(h));
  }
}
const zt = {
  continuation: {
    tokenize: lw
  },
  exit: sw,
  name: "list",
  tokenize: ow
}, rw = {
  partial: !0,
  tokenize: uw
}, iw = {
  partial: !0,
  tokenize: aw
};
function ow(e, r, i) {
  const o = this, a = o.events[o.events.length - 1];
  let s = a && a[1].type === "linePrefix" ? a[2].sliceSerialize(a[1], !0).length : 0, c = 0;
  return d;
  function d(x) {
    const E = o.containerState.type || (x === 42 || x === 43 || x === 45 ? "listUnordered" : "listOrdered");
    if (E === "listUnordered" ? !o.containerState.marker || x === o.containerState.marker : iu(x)) {
      if (o.containerState.type || (o.containerState.type = E, e.enter(E, {
        _container: !0
      })), E === "listUnordered")
        return e.enter("listItemPrefix"), x === 42 || x === 45 ? e.check(_l, i, h)(x) : h(x);
      if (!o.interrupt || x === 49)
        return e.enter("listItemPrefix"), e.enter("listItemValue"), p(x);
    }
    return i(x);
  }
  function p(x) {
    return iu(x) && ++c < 10 ? (e.consume(x), p) : (!o.interrupt || c < 2) && (o.containerState.marker ? x === o.containerState.marker : x === 41 || x === 46) ? (e.exit("listItemValue"), h(x)) : i(x);
  }
  function h(x) {
    return e.enter("listItemMarker"), e.consume(x), e.exit("listItemMarker"), o.containerState.marker = o.containerState.marker || x, e.check(
      ao,
      // Can’t be empty when interrupting.
      o.interrupt ? i : m,
      e.attempt(rw, w, v)
    );
  }
  function m(x) {
    return o.containerState.initialBlankLine = !0, s++, w(x);
  }
  function v(x) {
    return Pe(x) ? (e.enter("listItemPrefixWhitespace"), e.consume(x), e.exit("listItemPrefixWhitespace"), w) : i(x);
  }
  function w(x) {
    return o.containerState.size = s + o.sliceSerialize(e.exit("listItemPrefix"), !0).length, r(x);
  }
}
function lw(e, r, i) {
  const o = this;
  return o.containerState._closeFlow = void 0, e.check(ao, a, s);
  function a(d) {
    return o.containerState.furtherBlankLines = o.containerState.furtherBlankLines || o.containerState.initialBlankLine, Oe(e, r, "listItemIndent", o.containerState.size + 1)(d);
  }
  function s(d) {
    return o.containerState.furtherBlankLines || !Pe(d) ? (o.containerState.furtherBlankLines = void 0, o.containerState.initialBlankLine = void 0, c(d)) : (o.containerState.furtherBlankLines = void 0, o.containerState.initialBlankLine = void 0, e.attempt(iw, r, c)(d));
  }
  function c(d) {
    return o.containerState._closeFlow = !0, o.interrupt = void 0, Oe(e, e.attempt(zt, r, i), "linePrefix", o.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(d);
  }
}
function aw(e, r, i) {
  const o = this;
  return Oe(e, a, "listItemIndent", o.containerState.size + 1);
  function a(s) {
    const c = o.events[o.events.length - 1];
    return c && c[1].type === "listItemIndent" && c[2].sliceSerialize(c[1], !0).length === o.containerState.size ? r(s) : i(s);
  }
}
function sw(e) {
  e.exit(this.containerState.type);
}
function uw(e, r, i) {
  const o = this;
  return Oe(e, a, "listItemPrefixWhitespace", o.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
  function a(s) {
    const c = o.events[o.events.length - 1];
    return !Pe(s) && c && c[1].type === "listItemPrefixWhitespace" ? r(s) : i(s);
  }
}
const fp = {
  name: "setextUnderline",
  resolveTo: cw,
  tokenize: dw
};
function cw(e, r) {
  let i = e.length, o, a, s;
  for (; i--; )
    if (e[i][0] === "enter") {
      if (e[i][1].type === "content") {
        o = i;
        break;
      }
      e[i][1].type === "paragraph" && (a = i);
    } else
      e[i][1].type === "content" && e.splice(i, 1), !s && e[i][1].type === "definition" && (s = i);
  const c = {
    type: "setextHeading",
    start: {
      ...e[o][1].start
    },
    end: {
      ...e[e.length - 1][1].end
    }
  };
  return e[a][1].type = "setextHeadingText", s ? (e.splice(a, 0, ["enter", c, r]), e.splice(s + 1, 0, ["exit", e[o][1], r]), e[o][1].end = {
    ...e[s][1].end
  }) : e[o][1] = c, e.push(["exit", c, r]), e;
}
function dw(e, r, i) {
  const o = this;
  let a;
  return s;
  function s(h) {
    let m = o.events.length, v;
    for (; m--; )
      if (o.events[m][1].type !== "lineEnding" && o.events[m][1].type !== "linePrefix" && o.events[m][1].type !== "content") {
        v = o.events[m][1].type === "paragraph";
        break;
      }
    return !o.parser.lazy[o.now().line] && (o.interrupt || v) ? (e.enter("setextHeadingLine"), a = h, c(h)) : i(h);
  }
  function c(h) {
    return e.enter("setextHeadingLineSequence"), d(h);
  }
  function d(h) {
    return h === a ? (e.consume(h), d) : (e.exit("setextHeadingLineSequence"), Pe(h) ? Oe(e, p, "lineSuffix")(h) : p(h));
  }
  function p(h) {
    return h === null || Se(h) ? (e.exit("setextHeadingLine"), r(h)) : i(h);
  }
}
const fw = {
  tokenize: pw
};
function pw(e) {
  const r = this, i = e.attempt(
    // Try to parse a blank line.
    ao,
    o,
    // Try to parse initial flow (essentially, only code).
    e.attempt(this.parser.constructs.flowInitial, a, Oe(e, e.attempt(this.parser.constructs.flow, a, e.attempt(vk, a)), "linePrefix"))
  );
  return i;
  function o(s) {
    if (s === null) {
      e.consume(s);
      return;
    }
    return e.enter("lineEndingBlank"), e.consume(s), e.exit("lineEndingBlank"), r.currentConstruct = void 0, i;
  }
  function a(s) {
    if (s === null) {
      e.consume(s);
      return;
    }
    return e.enter("lineEnding"), e.consume(s), e.exit("lineEnding"), r.currentConstruct = void 0, i;
  }
}
const hw = {
  resolveAll: Ih()
}, mw = Ph("string"), gw = Ph("text");
function Ph(e) {
  return {
    resolveAll: Ih(e === "text" ? yw : void 0),
    tokenize: r
  };
  function r(i) {
    const o = this, a = this.parser.constructs[e], s = i.attempt(a, c, d);
    return c;
    function c(m) {
      return h(m) ? s(m) : d(m);
    }
    function d(m) {
      if (m === null) {
        i.consume(m);
        return;
      }
      return i.enter("data"), i.consume(m), p;
    }
    function p(m) {
      return h(m) ? (i.exit("data"), s(m)) : (i.consume(m), p);
    }
    function h(m) {
      if (m === null)
        return !0;
      const v = a[m];
      let w = -1;
      if (v)
        for (; ++w < v.length; ) {
          const x = v[w];
          if (!x.previous || x.previous.call(o, o.previous))
            return !0;
        }
      return !1;
    }
  }
}
function Ih(e) {
  return r;
  function r(i, o) {
    let a = -1, s;
    for (; ++a <= i.length; )
      s === void 0 ? i[a] && i[a][1].type === "data" && (s = a, a++) : (!i[a] || i[a][1].type !== "data") && (a !== s + 2 && (i[s][1].end = i[a - 1][1].end, i.splice(s + 2, a - s - 2), a = s + 2), s = void 0);
    return e ? e(i, o) : i;
  }
}
function yw(e, r) {
  let i = 0;
  for (; ++i <= e.length; )
    if ((i === e.length || e[i][1].type === "lineEnding") && e[i - 1][1].type === "data") {
      const o = e[i - 1][1], a = r.sliceStream(o);
      let s = a.length, c = -1, d = 0, p;
      for (; s--; ) {
        const h = a[s];
        if (typeof h == "string") {
          for (c = h.length; h.charCodeAt(c - 1) === 32; )
            d++, c--;
          if (c) break;
          c = -1;
        } else if (h === -2)
          p = !0, d++;
        else if (h !== -1) {
          s++;
          break;
        }
      }
      if (r._contentTypeTextTrailing && i === e.length && (d = 0), d) {
        const h = {
          type: i === e.length || p || d < 2 ? "lineSuffix" : "hardBreakTrailing",
          start: {
            _bufferIndex: s ? c : o.start._bufferIndex + c,
            _index: o.start._index + s,
            line: o.end.line,
            column: o.end.column - d,
            offset: o.end.offset - d
          },
          end: {
            ...o.end
          }
        };
        o.end = {
          ...h.start
        }, o.start.offset === o.end.offset ? Object.assign(o, h) : (e.splice(i, 0, ["enter", h, r], ["exit", h, r]), i += 2);
      }
      i++;
    }
  return e;
}
const vw = {
  42: zt,
  43: zt,
  45: zt,
  48: zt,
  49: zt,
  50: zt,
  51: zt,
  52: zt,
  53: zt,
  54: zt,
  55: zt,
  56: zt,
  57: zt,
  62: Th
}, xw = {
  91: Sk
}, kw = {
  [-2]: zs,
  [-1]: zs,
  32: zs
}, ww = {
  35: Rk,
  42: _l,
  45: [fp, _l],
  60: zk,
  61: fp,
  95: _l,
  96: cp,
  126: cp
}, bw = {
  38: Rh,
  92: jh
}, Sw = {
  [-5]: Ps,
  [-4]: Ps,
  [-3]: Ps,
  33: Xk,
  38: Rh,
  42: ou,
  60: [Zx, $k],
  91: Zk,
  92: [Tk, jh],
  93: Au,
  95: ou,
  96: fk
}, Cw = {
  null: [ou, hw]
}, Ew = {
  null: [42, 95]
}, _w = {
  null: []
}, Tw = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  attentionMarkers: Ew,
  contentInitial: xw,
  disable: _w,
  document: vw,
  flow: ww,
  flowInitial: kw,
  insideSpan: Cw,
  string: bw,
  text: Sw
}, Symbol.toStringTag, { value: "Module" }));
function jw(e, r, i) {
  let o = {
    _bufferIndex: -1,
    _index: 0,
    line: i && i.line || 1,
    column: i && i.column || 1,
    offset: i && i.offset || 0
  };
  const a = {}, s = [];
  let c = [], d = [];
  const p = {
    attempt: Y(Z),
    check: Y(j),
    consume: U,
    enter: B,
    exit: ne,
    interrupt: Y(j, {
      interrupt: !0
    })
  }, h = {
    code: null,
    containerState: {},
    defineSkip: L,
    events: [],
    now: E,
    parser: e,
    previous: null,
    sliceSerialize: w,
    sliceStream: x,
    write: v
  };
  let m = r.tokenize.call(h, p);
  return r.resolveAll && s.push(r), h;
  function v(te) {
    return c = Kt(c, te), D(), c[c.length - 1] !== null ? [] : (se(r, 0), h.events = Dl(s, h.events, h), h.events);
  }
  function w(te, ie) {
    return Lw(x(te), ie);
  }
  function x(te) {
    return Rw(c, te);
  }
  function E() {
    const {
      _bufferIndex: te,
      _index: ie,
      line: xe,
      column: oe,
      offset: X
    } = o;
    return {
      _bufferIndex: te,
      _index: ie,
      line: xe,
      column: oe,
      offset: X
    };
  }
  function L(te) {
    a[te.line] = te.column, I();
  }
  function D() {
    let te;
    for (; o._index < c.length; ) {
      const ie = c[o._index];
      if (typeof ie == "string")
        for (te = o._index, o._bufferIndex < 0 && (o._bufferIndex = 0); o._index === te && o._bufferIndex < ie.length; )
          z(ie.charCodeAt(o._bufferIndex));
      else
        z(ie);
    }
  }
  function z(te) {
    m = m(te);
  }
  function U(te) {
    Se(te) ? (o.line++, o.column = 1, o.offset += te === -3 ? 2 : 1, I()) : te !== -1 && (o.column++, o.offset++), o._bufferIndex < 0 ? o._index++ : (o._bufferIndex++, o._bufferIndex === // Points w/ non-negative `_bufferIndex` reference
    // strings.
    /** @type {string} */
    c[o._index].length && (o._bufferIndex = -1, o._index++)), h.previous = te;
  }
  function B(te, ie) {
    const xe = ie || {};
    return xe.type = te, xe.start = E(), h.events.push(["enter", xe, h]), d.push(xe), xe;
  }
  function ne(te) {
    const ie = d.pop();
    return ie.end = E(), h.events.push(["exit", ie, h]), ie;
  }
  function Z(te, ie) {
    se(te, ie.from);
  }
  function j(te, ie) {
    ie.restore();
  }
  function Y(te, ie) {
    return xe;
    function xe(oe, X, ge) {
      let Ce, q, N, b;
      return Array.isArray(oe) ? (
        /* c8 ignore next 1 */
        O(oe)
      ) : "tokenize" in oe ? (
        // Looks like a construct.
        O([
          /** @type {Construct} */
          oe
        ])
      ) : _(oe);
      function _(he) {
        return Re;
        function Re(_e) {
          const Ne = _e !== null && he[_e], Be = _e !== null && he.null, He = [
            // To do: add more extension tests.
            /* c8 ignore next 2 */
            ...Array.isArray(Ne) ? Ne : Ne ? [Ne] : [],
            ...Array.isArray(Be) ? Be : Be ? [Be] : []
          ];
          return O(He)(_e);
        }
      }
      function O(he) {
        return Ce = he, q = 0, he.length === 0 ? ge : S(he[q]);
      }
      function S(he) {
        return Re;
        function Re(_e) {
          return b = re(), N = he, he.partial || (h.currentConstruct = he), he.name && h.parser.constructs.disable.null.includes(he.name) ? ye() : he.tokenize.call(
            // If we do have fields, create an object w/ `context` as its
            // prototype.
            // This allows a “live binding”, which is needed for `interrupt`.
            ie ? Object.assign(Object.create(h), ie) : h,
            p,
            le,
            ye
          )(_e);
        }
      }
      function le(he) {
        return te(N, b), X;
      }
      function ye(he) {
        return b.restore(), ++q < Ce.length ? S(Ce[q]) : ge;
      }
    }
  }
  function se(te, ie) {
    te.resolveAll && !s.includes(te) && s.push(te), te.resolve && $t(h.events, ie, h.events.length - ie, te.resolve(h.events.slice(ie), h)), te.resolveTo && (h.events = te.resolveTo(h.events, h));
  }
  function re() {
    const te = E(), ie = h.previous, xe = h.currentConstruct, oe = h.events.length, X = Array.from(d);
    return {
      from: oe,
      restore: ge
    };
    function ge() {
      o = te, h.previous = ie, h.currentConstruct = xe, h.events.length = oe, d = X, I();
    }
  }
  function I() {
    o.line in a && o.column < 2 && (o.column = a[o.line], o.offset += a[o.line] - 1);
  }
}
function Rw(e, r) {
  const i = r.start._index, o = r.start._bufferIndex, a = r.end._index, s = r.end._bufferIndex;
  let c;
  if (i === a)
    c = [e[i].slice(o, s)];
  else {
    if (c = e.slice(i, a), o > -1) {
      const d = c[0];
      typeof d == "string" ? c[0] = d.slice(o) : c.shift();
    }
    s > 0 && c.push(e[a].slice(0, s));
  }
  return c;
}
function Lw(e, r) {
  let i = -1;
  const o = [];
  let a;
  for (; ++i < e.length; ) {
    const s = e[i];
    let c;
    if (typeof s == "string")
      c = s;
    else switch (s) {
      case -5: {
        c = "\r";
        break;
      }
      case -4: {
        c = `
`;
        break;
      }
      case -3: {
        c = `\r
`;
        break;
      }
      case -2: {
        c = r ? " " : "	";
        break;
      }
      case -1: {
        if (!r && a) continue;
        c = " ";
        break;
      }
      default:
        c = String.fromCharCode(s);
    }
    a = s === -2, o.push(c);
  }
  return o.join("");
}
function Nw(e) {
  const o = {
    constructs: (
      /** @type {FullNormalizedExtension} */
      Eh([Tw, ...(e || {}).extensions || []])
    ),
    content: a(Vx),
    defined: [],
    document: a(Qx),
    flow: a(fw),
    lazy: {},
    string: a(mw),
    text: a(gw)
  };
  return o;
  function a(s) {
    return c;
    function c(d) {
      return jw(o, s, d);
    }
  }
}
function Aw(e) {
  for (; !Lh(e); )
    ;
  return e;
}
const pp = /[\0\t\n\r]/g;
function zw() {
  let e = 1, r = "", i = !0, o;
  return a;
  function a(s, c, d) {
    const p = [];
    let h, m, v, w, x;
    for (s = r + (typeof s == "string" ? s.toString() : new TextDecoder(c || void 0).decode(s)), v = 0, r = "", i && (s.charCodeAt(0) === 65279 && v++, i = void 0); v < s.length; ) {
      if (pp.lastIndex = v, h = pp.exec(s), w = h && h.index !== void 0 ? h.index : s.length, x = s.charCodeAt(w), !h) {
        r = s.slice(v);
        break;
      }
      if (x === 10 && v === w && o)
        p.push(-3), o = void 0;
      else
        switch (o && (p.push(-5), o = void 0), v < w && (p.push(s.slice(v, w)), e += w - v), x) {
          case 0: {
            p.push(65533), e++;
            break;
          }
          case 9: {
            for (m = Math.ceil(e / 4) * 4, p.push(-2); e++ < m; ) p.push(-1);
            break;
          }
          case 10: {
            p.push(-4), e = 1;
            break;
          }
          default:
            o = !0, e = 1;
        }
      v = w + 1;
    }
    return d && (o && p.push(-5), r && p.push(r), p.push(null)), p;
  }
}
const Pw = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function Iw(e) {
  return e.replace(Pw, Dw);
}
function Dw(e, r, i) {
  if (r)
    return r;
  if (i.charCodeAt(0) === 35) {
    const a = i.charCodeAt(1), s = a === 120 || a === 88;
    return _h(i.slice(s ? 2 : 1), s ? 16 : 10);
  }
  return Nu(i) || e;
}
const Dh = {}.hasOwnProperty;
function Mw(e, r, i) {
  return r && typeof r == "object" && (i = r, r = void 0), Ow(i)(Aw(Nw(i).document().write(zw()(e, r, !0))));
}
function Ow(e) {
  const r = {
    transforms: [],
    canContainEols: ["emphasis", "fragment", "heading", "paragraph", "strong"],
    enter: {
      autolink: s(dt),
      autolinkProtocol: re,
      autolinkEmail: re,
      atxHeading: s(Ue),
      blockQuote: s(Be),
      characterEscape: re,
      characterReference: re,
      codeFenced: s(He),
      codeFencedFenceInfo: c,
      codeFencedFenceMeta: c,
      codeIndented: s(He, c),
      codeText: s(Sn, c),
      codeTextData: re,
      data: re,
      codeFlowValue: re,
      definition: s(W),
      definitionDestinationString: c,
      definitionLabelString: c,
      definitionTitleString: c,
      emphasis: s(Ae),
      hardBreakEscape: s(We),
      hardBreakTrailing: s(We),
      htmlFlow: s(Jt, c),
      htmlFlowData: re,
      htmlText: s(Jt, c),
      htmlTextData: re,
      image: s(jr),
      label: c,
      link: s(dt),
      listItem: s(un),
      listItemValue: w,
      listOrdered: s(sn, v),
      listUnordered: s(sn),
      paragraph: s(cn),
      reference: S,
      referenceString: c,
      resourceDestinationString: c,
      resourceTitleString: c,
      setextHeading: s(Ue),
      strong: s(dn),
      thematicBreak: s(Cn)
    },
    exit: {
      atxHeading: p(),
      atxHeadingSequence: Z,
      autolink: p(),
      autolinkEmail: Ne,
      autolinkProtocol: _e,
      blockQuote: p(),
      characterEscapeValue: I,
      characterReferenceMarkerHexadecimal: ye,
      characterReferenceMarkerNumeric: ye,
      characterReferenceValue: he,
      characterReference: Re,
      codeFenced: p(D),
      codeFencedFence: L,
      codeFencedFenceInfo: x,
      codeFencedFenceMeta: E,
      codeFlowValue: I,
      codeIndented: p(z),
      codeText: p(X),
      codeTextData: I,
      data: I,
      definition: p(),
      definitionDestinationString: ne,
      definitionLabelString: U,
      definitionTitleString: B,
      emphasis: p(),
      hardBreakEscape: p(ie),
      hardBreakTrailing: p(ie),
      htmlFlow: p(xe),
      htmlFlowData: I,
      htmlText: p(oe),
      htmlTextData: I,
      image: p(Ce),
      label: N,
      labelText: q,
      lineEnding: te,
      link: p(ge),
      listItem: p(),
      listOrdered: p(),
      listUnordered: p(),
      paragraph: p(),
      referenceString: le,
      resourceDestinationString: b,
      resourceTitleString: _,
      resource: O,
      setextHeading: p(se),
      setextHeadingLineSequence: Y,
      setextHeadingText: j,
      strong: p(),
      thematicBreak: p()
    }
  };
  Mh(r, (e || {}).mdastExtensions || []);
  const i = {};
  return o;
  function o(H) {
    let ee = {
      type: "root",
      children: []
    };
    const ve = {
      stack: [ee],
      tokenStack: [],
      config: r,
      enter: d,
      exit: h,
      buffer: c,
      resume: m,
      data: i
    }, Le = [];
    let De = -1;
    for (; ++De < H.length; )
      if (H[De][1].type === "listOrdered" || H[De][1].type === "listUnordered")
        if (H[De][0] === "enter")
          Le.push(De);
        else {
          const Ke = Le.pop();
          De = a(H, Ke, De);
        }
    for (De = -1; ++De < H.length; ) {
      const Ke = r[H[De][0]];
      Dh.call(Ke, H[De][1].type) && Ke[H[De][1].type].call(Object.assign({
        sliceSerialize: H[De][2].sliceSerialize
      }, ve), H[De][1]);
    }
    if (ve.tokenStack.length > 0) {
      const Ke = ve.tokenStack[ve.tokenStack.length - 1];
      (Ke[1] || hp).call(ve, void 0, Ke[0]);
    }
    for (ee.position = {
      start: rr(H.length > 0 ? H[0][1].start : {
        line: 1,
        column: 1,
        offset: 0
      }),
      end: rr(H.length > 0 ? H[H.length - 2][1].end : {
        line: 1,
        column: 1,
        offset: 0
      })
    }, De = -1; ++De < r.transforms.length; )
      ee = r.transforms[De](ee) || ee;
    return ee;
  }
  function a(H, ee, ve) {
    let Le = ee - 1, De = -1, Ke = !1, Bt, St, ke, fe;
    for (; ++Le <= ve; ) {
      const Ee = H[Le];
      switch (Ee[1].type) {
        case "listUnordered":
        case "listOrdered":
        case "blockQuote": {
          Ee[0] === "enter" ? De++ : De--, fe = void 0;
          break;
        }
        case "lineEndingBlank": {
          Ee[0] === "enter" && (Bt && !fe && !De && !ke && (ke = Le), fe = void 0);
          break;
        }
        case "linePrefix":
        case "listItemValue":
        case "listItemMarker":
        case "listItemPrefix":
        case "listItemPrefixWhitespace":
          break;
        default:
          fe = void 0;
      }
      if (!De && Ee[0] === "enter" && Ee[1].type === "listItemPrefix" || De === -1 && Ee[0] === "exit" && (Ee[1].type === "listUnordered" || Ee[1].type === "listOrdered")) {
        if (Bt) {
          let it = Le;
          for (St = void 0; it--; ) {
            const tt = H[it];
            if (tt[1].type === "lineEnding" || tt[1].type === "lineEndingBlank") {
              if (tt[0] === "exit") continue;
              St && (H[St][1].type = "lineEndingBlank", Ke = !0), tt[1].type = "lineEnding", St = it;
            } else if (!(tt[1].type === "linePrefix" || tt[1].type === "blockQuotePrefix" || tt[1].type === "blockQuotePrefixWhitespace" || tt[1].type === "blockQuoteMarker" || tt[1].type === "listItemIndent")) break;
          }
          ke && (!St || ke < St) && (Bt._spread = !0), Bt.end = Object.assign({}, St ? H[St][1].start : Ee[1].end), H.splice(St || Le, 0, ["exit", Bt, Ee[2]]), Le++, ve++;
        }
        if (Ee[1].type === "listItemPrefix") {
          const it = {
            type: "listItem",
            _spread: !1,
            start: Object.assign({}, Ee[1].start),
            // @ts-expect-error: we’ll add `end` in a second.
            end: void 0
          };
          Bt = it, H.splice(Le, 0, ["enter", it, Ee[2]]), Le++, ve++, ke = void 0, fe = !0;
        }
      }
    }
    return H[ee][1]._spread = Ke, ve;
  }
  function s(H, ee) {
    return ve;
    function ve(Le) {
      d.call(this, H(Le), Le), ee && ee.call(this, Le);
    }
  }
  function c() {
    this.stack.push({
      type: "fragment",
      children: []
    });
  }
  function d(H, ee, ve) {
    this.stack[this.stack.length - 1].children.push(H), this.stack.push(H), this.tokenStack.push([ee, ve || void 0]), H.position = {
      start: rr(ee.start),
      // @ts-expect-error: `end` will be patched later.
      end: void 0
    };
  }
  function p(H) {
    return ee;
    function ee(ve) {
      H && H.call(this, ve), h.call(this, ve);
    }
  }
  function h(H, ee) {
    const ve = this.stack.pop(), Le = this.tokenStack.pop();
    if (Le)
      Le[0].type !== H.type && (ee ? ee.call(this, H, Le[0]) : (Le[1] || hp).call(this, H, Le[0]));
    else throw new Error("Cannot close `" + H.type + "` (" + Yi({
      start: H.start,
      end: H.end
    }) + "): it’s not open");
    ve.position.end = rr(H.end);
  }
  function m() {
    return Lu(this.stack.pop());
  }
  function v() {
    this.data.expectingFirstListItemValue = !0;
  }
  function w(H) {
    if (this.data.expectingFirstListItemValue) {
      const ee = this.stack[this.stack.length - 2];
      ee.start = Number.parseInt(this.sliceSerialize(H), 10), this.data.expectingFirstListItemValue = void 0;
    }
  }
  function x() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.lang = H;
  }
  function E() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.meta = H;
  }
  function L() {
    this.data.flowCodeInside || (this.buffer(), this.data.flowCodeInside = !0);
  }
  function D() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.value = H.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, ""), this.data.flowCodeInside = void 0;
  }
  function z() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.value = H.replace(/(\r?\n|\r)$/g, "");
  }
  function U(H) {
    const ee = this.resume(), ve = this.stack[this.stack.length - 1];
    ve.label = ee, ve.identifier = an(this.sliceSerialize(H)).toLowerCase();
  }
  function B() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.title = H;
  }
  function ne() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.url = H;
  }
  function Z(H) {
    const ee = this.stack[this.stack.length - 1];
    if (!ee.depth) {
      const ve = this.sliceSerialize(H).length;
      ee.depth = ve;
    }
  }
  function j() {
    this.data.setextHeadingSlurpLineEnding = !0;
  }
  function Y(H) {
    const ee = this.stack[this.stack.length - 1];
    ee.depth = this.sliceSerialize(H).codePointAt(0) === 61 ? 1 : 2;
  }
  function se() {
    this.data.setextHeadingSlurpLineEnding = void 0;
  }
  function re(H) {
    const ve = this.stack[this.stack.length - 1].children;
    let Le = ve[ve.length - 1];
    (!Le || Le.type !== "text") && (Le = fn(), Le.position = {
      start: rr(H.start),
      // @ts-expect-error: we’ll add `end` later.
      end: void 0
    }, ve.push(Le)), this.stack.push(Le);
  }
  function I(H) {
    const ee = this.stack.pop();
    ee.value += this.sliceSerialize(H), ee.position.end = rr(H.end);
  }
  function te(H) {
    const ee = this.stack[this.stack.length - 1];
    if (this.data.atHardBreak) {
      const ve = ee.children[ee.children.length - 1];
      ve.position.end = rr(H.end), this.data.atHardBreak = void 0;
      return;
    }
    !this.data.setextHeadingSlurpLineEnding && r.canContainEols.includes(ee.type) && (re.call(this, H), I.call(this, H));
  }
  function ie() {
    this.data.atHardBreak = !0;
  }
  function xe() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.value = H;
  }
  function oe() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.value = H;
  }
  function X() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.value = H;
  }
  function ge() {
    const H = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const ee = this.data.referenceType || "shortcut";
      H.type += "Reference", H.referenceType = ee, delete H.url, delete H.title;
    } else
      delete H.identifier, delete H.label;
    this.data.referenceType = void 0;
  }
  function Ce() {
    const H = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const ee = this.data.referenceType || "shortcut";
      H.type += "Reference", H.referenceType = ee, delete H.url, delete H.title;
    } else
      delete H.identifier, delete H.label;
    this.data.referenceType = void 0;
  }
  function q(H) {
    const ee = this.sliceSerialize(H), ve = this.stack[this.stack.length - 2];
    ve.label = Iw(ee), ve.identifier = an(ee).toLowerCase();
  }
  function N() {
    const H = this.stack[this.stack.length - 1], ee = this.resume(), ve = this.stack[this.stack.length - 1];
    if (this.data.inReference = !0, ve.type === "link") {
      const Le = H.children;
      ve.children = Le;
    } else
      ve.alt = ee;
  }
  function b() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.url = H;
  }
  function _() {
    const H = this.resume(), ee = this.stack[this.stack.length - 1];
    ee.title = H;
  }
  function O() {
    this.data.inReference = void 0;
  }
  function S() {
    this.data.referenceType = "collapsed";
  }
  function le(H) {
    const ee = this.resume(), ve = this.stack[this.stack.length - 1];
    ve.label = ee, ve.identifier = an(this.sliceSerialize(H)).toLowerCase(), this.data.referenceType = "full";
  }
  function ye(H) {
    this.data.characterReferenceType = H.type;
  }
  function he(H) {
    const ee = this.sliceSerialize(H), ve = this.data.characterReferenceType;
    let Le;
    ve ? (Le = _h(ee, ve === "characterReferenceMarkerNumeric" ? 10 : 16), this.data.characterReferenceType = void 0) : Le = Nu(ee);
    const De = this.stack[this.stack.length - 1];
    De.value += Le;
  }
  function Re(H) {
    const ee = this.stack.pop();
    ee.position.end = rr(H.end);
  }
  function _e(H) {
    I.call(this, H);
    const ee = this.stack[this.stack.length - 1];
    ee.url = this.sliceSerialize(H);
  }
  function Ne(H) {
    I.call(this, H);
    const ee = this.stack[this.stack.length - 1];
    ee.url = "mailto:" + this.sliceSerialize(H);
  }
  function Be() {
    return {
      type: "blockquote",
      children: []
    };
  }
  function He() {
    return {
      type: "code",
      lang: null,
      meta: null,
      value: ""
    };
  }
  function Sn() {
    return {
      type: "inlineCode",
      value: ""
    };
  }
  function W() {
    return {
      type: "definition",
      identifier: "",
      label: null,
      title: null,
      url: ""
    };
  }
  function Ae() {
    return {
      type: "emphasis",
      children: []
    };
  }
  function Ue() {
    return {
      type: "heading",
      // @ts-expect-error `depth` will be set later.
      depth: 0,
      children: []
    };
  }
  function We() {
    return {
      type: "break"
    };
  }
  function Jt() {
    return {
      type: "html",
      value: ""
    };
  }
  function jr() {
    return {
      type: "image",
      title: null,
      url: "",
      alt: null
    };
  }
  function dt() {
    return {
      type: "link",
      title: null,
      url: "",
      children: []
    };
  }
  function sn(H) {
    return {
      type: "list",
      ordered: H.type === "listOrdered",
      start: null,
      spread: H._spread,
      children: []
    };
  }
  function un(H) {
    return {
      type: "listItem",
      spread: H._spread,
      checked: null,
      children: []
    };
  }
  function cn() {
    return {
      type: "paragraph",
      children: []
    };
  }
  function dn() {
    return {
      type: "strong",
      children: []
    };
  }
  function fn() {
    return {
      type: "text",
      value: ""
    };
  }
  function Cn() {
    return {
      type: "thematicBreak"
    };
  }
}
function rr(e) {
  return {
    line: e.line,
    column: e.column,
    offset: e.offset
  };
}
function Mh(e, r) {
  let i = -1;
  for (; ++i < r.length; ) {
    const o = r[i];
    Array.isArray(o) ? Mh(e, o) : Fw(e, o);
  }
}
function Fw(e, r) {
  let i;
  for (i in r)
    if (Dh.call(r, i))
      switch (i) {
        case "canContainEols": {
          const o = r[i];
          o && e[i].push(...o);
          break;
        }
        case "transforms": {
          const o = r[i];
          o && e[i].push(...o);
          break;
        }
        case "enter":
        case "exit": {
          const o = r[i];
          o && Object.assign(e[i], o);
          break;
        }
      }
}
function hp(e, r) {
  throw e ? new Error("Cannot close `" + e.type + "` (" + Yi({
    start: e.start,
    end: e.end
  }) + "): a different token (`" + r.type + "`, " + Yi({
    start: r.start,
    end: r.end
  }) + ") is open") : new Error("Cannot close document, a token (`" + r.type + "`, " + Yi({
    start: r.start,
    end: r.end
  }) + ") is still open");
}
function $w(e) {
  const r = this;
  r.parser = i;
  function i(o) {
    return Mw(o, {
      ...r.data("settings"),
      ...e,
      // Note: these options are not in the readme.
      // The goal is for them to be set by plugins on `data` instead of being
      // passed by users.
      extensions: r.data("micromarkExtensions") || [],
      mdastExtensions: r.data("fromMarkdownExtensions") || []
    });
  }
}
function Bw(e, r) {
  const i = {
    type: "element",
    tagName: "blockquote",
    properties: {},
    children: e.wrap(e.all(r), !0)
  };
  return e.patch(r, i), e.applyData(r, i);
}
function Hw(e, r) {
  const i = { type: "element", tagName: "br", properties: {}, children: [] };
  return e.patch(r, i), [e.applyData(r, i), { type: "text", value: `
` }];
}
function qw(e, r) {
  const i = r.value ? r.value + `
` : "", o = {}, a = r.lang ? r.lang.split(/\s+/) : [];
  a.length > 0 && (o.className = ["language-" + a[0]]);
  let s = {
    type: "element",
    tagName: "code",
    properties: o,
    children: [{ type: "text", value: i }]
  };
  return r.meta && (s.data = { meta: r.meta }), e.patch(r, s), s = e.applyData(r, s), s = { type: "element", tagName: "pre", properties: {}, children: [s] }, e.patch(r, s), s;
}
function Uw(e, r) {
  const i = {
    type: "element",
    tagName: "del",
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, i), e.applyData(r, i);
}
function Ww(e, r) {
  const i = {
    type: "element",
    tagName: "em",
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, i), e.applyData(r, i);
}
function Vw(e, r) {
  const i = typeof e.options.clobberPrefix == "string" ? e.options.clobberPrefix : "user-content-", o = String(r.identifier).toUpperCase(), a = li(o.toLowerCase()), s = e.footnoteOrder.indexOf(o);
  let c, d = e.footnoteCounts.get(o);
  d === void 0 ? (d = 0, e.footnoteOrder.push(o), c = e.footnoteOrder.length) : c = s + 1, d += 1, e.footnoteCounts.set(o, d);
  const p = {
    type: "element",
    tagName: "a",
    properties: {
      href: "#" + i + "fn-" + a,
      id: i + "fnref-" + a + (d > 1 ? "-" + d : ""),
      dataFootnoteRef: !0,
      ariaDescribedBy: ["footnote-label"]
    },
    children: [{ type: "text", value: String(c) }]
  };
  e.patch(r, p);
  const h = {
    type: "element",
    tagName: "sup",
    properties: {},
    children: [p]
  };
  return e.patch(r, h), e.applyData(r, h);
}
function Gw(e, r) {
  const i = {
    type: "element",
    tagName: "h" + r.depth,
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, i), e.applyData(r, i);
}
function Qw(e, r) {
  if (e.options.allowDangerousHtml) {
    const i = { type: "raw", value: r.value };
    return e.patch(r, i), e.applyData(r, i);
  }
}
function Oh(e, r) {
  const i = r.referenceType;
  let o = "]";
  if (i === "collapsed" ? o += "[]" : i === "full" && (o += "[" + (r.label || r.identifier) + "]"), r.type === "imageReference")
    return [{ type: "text", value: "![" + r.alt + o }];
  const a = e.all(r), s = a[0];
  s && s.type === "text" ? s.value = "[" + s.value : a.unshift({ type: "text", value: "[" });
  const c = a[a.length - 1];
  return c && c.type === "text" ? c.value += o : a.push({ type: "text", value: o }), a;
}
function Kw(e, r) {
  const i = String(r.identifier).toUpperCase(), o = e.definitionById.get(i);
  if (!o)
    return Oh(e, r);
  const a = { src: li(o.url || ""), alt: r.alt };
  o.title !== null && o.title !== void 0 && (a.title = o.title);
  const s = { type: "element", tagName: "img", properties: a, children: [] };
  return e.patch(r, s), e.applyData(r, s);
}
function Yw(e, r) {
  const i = { src: li(r.url) };
  r.alt !== null && r.alt !== void 0 && (i.alt = r.alt), r.title !== null && r.title !== void 0 && (i.title = r.title);
  const o = { type: "element", tagName: "img", properties: i, children: [] };
  return e.patch(r, o), e.applyData(r, o);
}
function Xw(e, r) {
  const i = { type: "text", value: r.value.replace(/\r?\n|\r/g, " ") };
  e.patch(r, i);
  const o = {
    type: "element",
    tagName: "code",
    properties: {},
    children: [i]
  };
  return e.patch(r, o), e.applyData(r, o);
}
function Jw(e, r) {
  const i = String(r.identifier).toUpperCase(), o = e.definitionById.get(i);
  if (!o)
    return Oh(e, r);
  const a = { href: li(o.url || "") };
  o.title !== null && o.title !== void 0 && (a.title = o.title);
  const s = {
    type: "element",
    tagName: "a",
    properties: a,
    children: e.all(r)
  };
  return e.patch(r, s), e.applyData(r, s);
}
function Zw(e, r) {
  const i = { href: li(r.url) };
  r.title !== null && r.title !== void 0 && (i.title = r.title);
  const o = {
    type: "element",
    tagName: "a",
    properties: i,
    children: e.all(r)
  };
  return e.patch(r, o), e.applyData(r, o);
}
function e0(e, r, i) {
  const o = e.all(r), a = i ? t0(i) : Fh(r), s = {}, c = [];
  if (typeof r.checked == "boolean") {
    const m = o[0];
    let v;
    m && m.type === "element" && m.tagName === "p" ? v = m : (v = { type: "element", tagName: "p", properties: {}, children: [] }, o.unshift(v)), v.children.length > 0 && v.children.unshift({ type: "text", value: " " }), v.children.unshift({
      type: "element",
      tagName: "input",
      properties: { type: "checkbox", checked: r.checked, disabled: !0 },
      children: []
    }), s.className = ["task-list-item"];
  }
  let d = -1;
  for (; ++d < o.length; ) {
    const m = o[d];
    (a || d !== 0 || m.type !== "element" || m.tagName !== "p") && c.push({ type: "text", value: `
` }), m.type === "element" && m.tagName === "p" && !a ? c.push(...m.children) : c.push(m);
  }
  const p = o[o.length - 1];
  p && (a || p.type !== "element" || p.tagName !== "p") && c.push({ type: "text", value: `
` });
  const h = { type: "element", tagName: "li", properties: s, children: c };
  return e.patch(r, h), e.applyData(r, h);
}
function t0(e) {
  let r = !1;
  if (e.type === "list") {
    r = e.spread || !1;
    const i = e.children;
    let o = -1;
    for (; !r && ++o < i.length; )
      r = Fh(i[o]);
  }
  return r;
}
function Fh(e) {
  const r = e.spread;
  return r ?? e.children.length > 1;
}
function n0(e, r) {
  const i = {}, o = e.all(r);
  let a = -1;
  for (typeof r.start == "number" && r.start !== 1 && (i.start = r.start); ++a < o.length; ) {
    const c = o[a];
    if (c.type === "element" && c.tagName === "li" && c.properties && Array.isArray(c.properties.className) && c.properties.className.includes("task-list-item")) {
      i.className = ["contains-task-list"];
      break;
    }
  }
  const s = {
    type: "element",
    tagName: r.ordered ? "ol" : "ul",
    properties: i,
    children: e.wrap(o, !0)
  };
  return e.patch(r, s), e.applyData(r, s);
}
function r0(e, r) {
  const i = {
    type: "element",
    tagName: "p",
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, i), e.applyData(r, i);
}
function i0(e, r) {
  const i = { type: "root", children: e.wrap(e.all(r)) };
  return e.patch(r, i), e.applyData(r, i);
}
function o0(e, r) {
  const i = {
    type: "element",
    tagName: "strong",
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, i), e.applyData(r, i);
}
function l0(e, r) {
  const i = e.all(r), o = i.shift(), a = [];
  if (o) {
    const c = {
      type: "element",
      tagName: "thead",
      properties: {},
      children: e.wrap([o], !0)
    };
    e.patch(r.children[0], c), a.push(c);
  }
  if (i.length > 0) {
    const c = {
      type: "element",
      tagName: "tbody",
      properties: {},
      children: e.wrap(i, !0)
    }, d = _u(r.children[1]), p = vh(r.children[r.children.length - 1]);
    d && p && (c.position = { start: d, end: p }), a.push(c);
  }
  const s = {
    type: "element",
    tagName: "table",
    properties: {},
    children: e.wrap(a, !0)
  };
  return e.patch(r, s), e.applyData(r, s);
}
function a0(e, r, i) {
  const o = i ? i.children : void 0, s = (o ? o.indexOf(r) : 1) === 0 ? "th" : "td", c = i && i.type === "table" ? i.align : void 0, d = c ? c.length : r.children.length;
  let p = -1;
  const h = [];
  for (; ++p < d; ) {
    const v = r.children[p], w = {}, x = c ? c[p] : void 0;
    x && (w.align = x);
    let E = { type: "element", tagName: s, properties: w, children: [] };
    v && (E.children = e.all(v), e.patch(v, E), E = e.applyData(v, E)), h.push(E);
  }
  const m = {
    type: "element",
    tagName: "tr",
    properties: {},
    children: e.wrap(h, !0)
  };
  return e.patch(r, m), e.applyData(r, m);
}
function s0(e, r) {
  const i = {
    type: "element",
    tagName: "td",
    // Assume body cell.
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, i), e.applyData(r, i);
}
const mp = 9, gp = 32;
function u0(e) {
  const r = String(e), i = /\r?\n|\r/g;
  let o = i.exec(r), a = 0;
  const s = [];
  for (; o; )
    s.push(
      yp(r.slice(a, o.index), a > 0, !0),
      o[0]
    ), a = o.index + o[0].length, o = i.exec(r);
  return s.push(yp(r.slice(a), a > 0, !1)), s.join("");
}
function yp(e, r, i) {
  let o = 0, a = e.length;
  if (r) {
    let s = e.codePointAt(o);
    for (; s === mp || s === gp; )
      o++, s = e.codePointAt(o);
  }
  if (i) {
    let s = e.codePointAt(a - 1);
    for (; s === mp || s === gp; )
      a--, s = e.codePointAt(a - 1);
  }
  return a > o ? e.slice(o, a) : "";
}
function c0(e, r) {
  const i = { type: "text", value: u0(String(r.value)) };
  return e.patch(r, i), e.applyData(r, i);
}
function d0(e, r) {
  const i = {
    type: "element",
    tagName: "hr",
    properties: {},
    children: []
  };
  return e.patch(r, i), e.applyData(r, i);
}
const f0 = {
  blockquote: Bw,
  break: Hw,
  code: qw,
  delete: Uw,
  emphasis: Ww,
  footnoteReference: Vw,
  heading: Gw,
  html: Qw,
  imageReference: Kw,
  image: Yw,
  inlineCode: Xw,
  linkReference: Jw,
  link: Zw,
  listItem: e0,
  list: n0,
  paragraph: r0,
  // @ts-expect-error: root is different, but hard to type.
  root: i0,
  strong: o0,
  table: l0,
  tableCell: s0,
  tableRow: a0,
  text: c0,
  thematicBreak: d0,
  toml: xl,
  yaml: xl,
  definition: xl,
  footnoteDefinition: xl
};
function xl() {
}
const $h = -1, Ml = 0, Ji = 1, jl = 2, zu = 3, Pu = 4, Iu = 5, Du = 6, Bh = 7, Hh = 8, p0 = typeof self == "object" ? self : globalThis, vp = (e, r) => {
  switch (e) {
    case "Function":
    case "SharedWorker":
    case "Worker":
    case "eval":
    case "setInterval":
    case "setTimeout":
      throw new TypeError("unable to deserialize " + e);
  }
  return new p0[e](r);
}, h0 = (e, r) => {
  const i = (a, s) => (e.set(s, a), a), o = (a) => {
    if (e.has(a))
      return e.get(a);
    const [s, c] = r[a];
    switch (s) {
      case Ml:
      case $h:
        return i(c, a);
      case Ji: {
        const d = i([], a);
        for (const p of c)
          d.push(o(p));
        return d;
      }
      case jl: {
        const d = i({}, a);
        for (const [p, h] of c)
          d[o(p)] = o(h);
        return d;
      }
      case zu:
        return i(new Date(c), a);
      case Pu: {
        const { source: d, flags: p } = c;
        return i(new RegExp(d, p), a);
      }
      case Iu: {
        const d = i(/* @__PURE__ */ new Map(), a);
        for (const [p, h] of c)
          d.set(o(p), o(h));
        return d;
      }
      case Du: {
        const d = i(/* @__PURE__ */ new Set(), a);
        for (const p of c)
          d.add(o(p));
        return d;
      }
      case Bh: {
        const { name: d, message: p } = c;
        return i(vp(d, p), a);
      }
      case Hh:
        return i(BigInt(c), a);
      case "BigInt":
        return i(Object(BigInt(c)), a);
      case "ArrayBuffer":
        return i(new Uint8Array(c).buffer, c);
      case "DataView": {
        const { buffer: d } = new Uint8Array(c);
        return i(new DataView(d), c);
      }
    }
    return i(vp(s, c), a);
  };
  return o;
}, xp = (e) => h0(/* @__PURE__ */ new Map(), e)(0), Cr = "", { toString: m0 } = {}, { keys: g0 } = Object, Gi = (e) => {
  const r = typeof e;
  if (r !== "object" || !e)
    return [Ml, r];
  const i = m0.call(e).slice(8, -1);
  switch (i) {
    case "Array":
      return [Ji, Cr];
    case "Object":
      return [jl, Cr];
    case "Date":
      return [zu, Cr];
    case "RegExp":
      return [Pu, Cr];
    case "Map":
      return [Iu, Cr];
    case "Set":
      return [Du, Cr];
    case "DataView":
      return [Ji, i];
  }
  return i.includes("Array") ? [Ji, i] : i.includes("Error") ? [Bh, i] : [jl, i];
}, kl = ([e, r]) => e === Ml && (r === "function" || r === "symbol"), y0 = (e, r, i, o) => {
  const a = (c, d) => {
    const p = o.push(c) - 1;
    return i.set(d, p), p;
  }, s = (c) => {
    if (i.has(c))
      return i.get(c);
    let [d, p] = Gi(c);
    switch (d) {
      case Ml: {
        let m = c;
        switch (p) {
          case "bigint":
            d = Hh, m = c.toString();
            break;
          case "function":
          case "symbol":
            if (e)
              throw new TypeError("unable to serialize " + p);
            m = null;
            break;
          case "undefined":
            return a([$h], c);
        }
        return a([d, m], c);
      }
      case Ji: {
        if (p) {
          let w = c;
          return p === "DataView" ? w = new Uint8Array(c.buffer) : p === "ArrayBuffer" && (w = new Uint8Array(c)), a([p, [...w]], c);
        }
        const m = [], v = a([d, m], c);
        for (const w of c)
          m.push(s(w));
        return v;
      }
      case jl: {
        if (p)
          switch (p) {
            case "BigInt":
              return a([p, c.toString()], c);
            case "Boolean":
            case "Number":
            case "String":
              return a([p, c.valueOf()], c);
          }
        if (r && "toJSON" in c)
          return s(c.toJSON());
        const m = [], v = a([d, m], c);
        for (const w of g0(c))
          (e || !kl(Gi(c[w]))) && m.push([s(w), s(c[w])]);
        return v;
      }
      case zu:
        return a([d, isNaN(c.getTime()) ? Cr : c.toISOString()], c);
      case Pu: {
        const { source: m, flags: v } = c;
        return a([d, { source: m, flags: v }], c);
      }
      case Iu: {
        const m = [], v = a([d, m], c);
        for (const [w, x] of c)
          (e || !(kl(Gi(w)) || kl(Gi(x)))) && m.push([s(w), s(x)]);
        return v;
      }
      case Du: {
        const m = [], v = a([d, m], c);
        for (const w of c)
          (e || !kl(Gi(w))) && m.push(s(w));
        return v;
      }
    }
    const { message: h } = c;
    return a([d, { name: p, message: h }], c);
  };
  return s;
}, kp = (e, { json: r, lossy: i } = {}) => {
  const o = [];
  return y0(!(r || i), !!r, /* @__PURE__ */ new Map(), o)(e), o;
}, Rl = typeof structuredClone == "function" ? (
  /* c8 ignore start */
  (e, r) => r && ("json" in r || "lossy" in r) ? xp(kp(e, r)) : structuredClone(e)
) : (e, r) => xp(kp(e, r));
function v0(e, r) {
  const i = [{ type: "text", value: "↩" }];
  return r > 1 && i.push({
    type: "element",
    tagName: "sup",
    properties: {},
    children: [{ type: "text", value: String(r) }]
  }), i;
}
function x0(e, r) {
  return "Back to reference " + (e + 1) + (r > 1 ? "-" + r : "");
}
function k0(e) {
  const r = typeof e.options.clobberPrefix == "string" ? e.options.clobberPrefix : "user-content-", i = e.options.footnoteBackContent || v0, o = e.options.footnoteBackLabel || x0, a = e.options.footnoteLabel || "Footnotes", s = e.options.footnoteLabelTagName || "h2", c = e.options.footnoteLabelProperties || {
    className: ["sr-only"]
  }, d = [];
  let p = -1;
  for (; ++p < e.footnoteOrder.length; ) {
    const h = e.footnoteById.get(
      e.footnoteOrder[p]
    );
    if (!h)
      continue;
    const m = e.all(h), v = String(h.identifier).toUpperCase(), w = li(v.toLowerCase());
    let x = 0;
    const E = [], L = e.footnoteCounts.get(v);
    for (; L !== void 0 && ++x <= L; ) {
      E.length > 0 && E.push({ type: "text", value: " " });
      let U = typeof i == "string" ? i : i(p, x);
      typeof U == "string" && (U = { type: "text", value: U }), E.push({
        type: "element",
        tagName: "a",
        properties: {
          href: "#" + r + "fnref-" + w + (x > 1 ? "-" + x : ""),
          dataFootnoteBackref: "",
          ariaLabel: typeof o == "string" ? o : o(p, x),
          className: ["data-footnote-backref"]
        },
        children: Array.isArray(U) ? U : [U]
      });
    }
    const D = m[m.length - 1];
    if (D && D.type === "element" && D.tagName === "p") {
      const U = D.children[D.children.length - 1];
      U && U.type === "text" ? U.value += " " : D.children.push({ type: "text", value: " " }), D.children.push(...E);
    } else
      m.push(...E);
    const z = {
      type: "element",
      tagName: "li",
      properties: { id: r + "fn-" + w },
      children: e.wrap(m, !0)
    };
    e.patch(h, z), d.push(z);
  }
  if (d.length !== 0)
    return {
      type: "element",
      tagName: "section",
      properties: { dataFootnotes: !0, className: ["footnotes"] },
      children: [
        {
          type: "element",
          tagName: s,
          properties: {
            ...Rl(c),
            id: "footnote-label"
          },
          children: [{ type: "text", value: a }]
        },
        { type: "text", value: `
` },
        {
          type: "element",
          tagName: "ol",
          properties: {},
          children: e.wrap(d, !0)
        },
        { type: "text", value: `
` }
      ]
    };
}
const Ol = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends string>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & {type: Condition}) &
   *   (<Condition extends Props>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Condition) &
   *   (<Condition extends TestFunction>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Predicate<Condition, Node>) &
   *   ((test?: null | undefined) => (node?: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test} [test]
   * @returns {Check}
   */
  (function(e) {
    if (e == null)
      return C0;
    if (typeof e == "function")
      return Fl(e);
    if (typeof e == "object")
      return Array.isArray(e) ? w0(e) : (
        // Cast because `ReadonlyArray` goes into the above but `isArray`
        // narrows to `Array`.
        b0(
          /** @type {Props} */
          e
        )
      );
    if (typeof e == "string")
      return S0(e);
    throw new Error("Expected function, string, or object as test");
  })
);
function w0(e) {
  const r = [];
  let i = -1;
  for (; ++i < e.length; )
    r[i] = Ol(e[i]);
  return Fl(o);
  function o(...a) {
    let s = -1;
    for (; ++s < r.length; )
      if (r[s].apply(this, a)) return !0;
    return !1;
  }
}
function b0(e) {
  const r = (
    /** @type {Record<string, unknown>} */
    e
  );
  return Fl(i);
  function i(o) {
    const a = (
      /** @type {Record<string, unknown>} */
      /** @type {unknown} */
      o
    );
    let s;
    for (s in e)
      if (a[s] !== r[s]) return !1;
    return !0;
  }
}
function S0(e) {
  return Fl(r);
  function r(i) {
    return i && i.type === e;
  }
}
function Fl(e) {
  return r;
  function r(i, o, a) {
    return !!(E0(i) && e.call(
      this,
      i,
      typeof o == "number" ? o : void 0,
      a || void 0
    ));
  }
}
function C0() {
  return !0;
}
function E0(e) {
  return e !== null && typeof e == "object" && "type" in e;
}
const qh = [], _0 = !0, lu = !1, T0 = "skip";
function Uh(e, r, i, o) {
  let a;
  typeof r == "function" && typeof i != "function" ? (o = i, i = r) : a = r;
  const s = Ol(a), c = o ? -1 : 1;
  d(e, void 0, [])();
  function d(p, h, m) {
    const v = (
      /** @type {Record<string, unknown>} */
      p && typeof p == "object" ? p : {}
    );
    if (typeof v.type == "string") {
      const x = (
        // `hast`
        typeof v.tagName == "string" ? v.tagName : (
          // `xast`
          typeof v.name == "string" ? v.name : void 0
        )
      );
      Object.defineProperty(w, "name", {
        value: "node (" + (p.type + (x ? "<" + x + ">" : "")) + ")"
      });
    }
    return w;
    function w() {
      let x = qh, E, L, D;
      if ((!r || s(p, h, m[m.length - 1] || void 0)) && (x = j0(i(p, m)), x[0] === lu))
        return x;
      if ("children" in p && p.children) {
        const z = (
          /** @type {UnistParent} */
          p
        );
        if (z.children && x[0] !== T0)
          for (L = (o ? z.children.length : -1) + c, D = m.concat(z); L > -1 && L < z.children.length; ) {
            const U = z.children[L];
            if (E = d(U, L, D)(), E[0] === lu)
              return E;
            L = typeof E[1] == "number" ? E[1] : L + c;
          }
      }
      return x;
    }
  }
}
function j0(e) {
  return Array.isArray(e) ? e : typeof e == "number" ? [_0, e] : e == null ? qh : [e];
}
function Mu(e, r, i, o) {
  let a, s, c;
  typeof r == "function" && typeof i != "function" ? (s = void 0, c = r, a = i) : (s = r, c = i, a = o), Uh(e, s, d, a);
  function d(p, h) {
    const m = h[h.length - 1], v = m ? m.children.indexOf(p) : void 0;
    return c(p, v, m);
  }
}
const au = {}.hasOwnProperty, R0 = {};
function L0(e, r) {
  const i = r || R0, o = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Map(), c = { ...f0, ...i.handlers }, d = {
    all: h,
    applyData: A0,
    definitionById: o,
    footnoteById: a,
    footnoteCounts: s,
    footnoteOrder: [],
    handlers: c,
    one: p,
    options: i,
    patch: N0,
    wrap: P0
  };
  return Mu(e, function(m) {
    if (m.type === "definition" || m.type === "footnoteDefinition") {
      const v = m.type === "definition" ? o : a, w = String(m.identifier).toUpperCase();
      v.has(w) || v.set(w, m);
    }
  }), d;
  function p(m, v) {
    const w = m.type, x = d.handlers[w];
    if (au.call(d.handlers, w) && x)
      return x(d, m, v);
    if (d.options.passThrough && d.options.passThrough.includes(w)) {
      if ("children" in m) {
        const { children: L, ...D } = m, z = Rl(D);
        return z.children = d.all(m), z;
      }
      return Rl(m);
    }
    return (d.options.unknownHandler || z0)(d, m, v);
  }
  function h(m) {
    const v = [];
    if ("children" in m) {
      const w = m.children;
      let x = -1;
      for (; ++x < w.length; ) {
        const E = d.one(w[x], m);
        if (E) {
          if (x && w[x - 1].type === "break" && (!Array.isArray(E) && E.type === "text" && (E.value = wp(E.value)), !Array.isArray(E) && E.type === "element")) {
            const L = E.children[0];
            L && L.type === "text" && (L.value = wp(L.value));
          }
          Array.isArray(E) ? v.push(...E) : v.push(E);
        }
      }
    }
    return v;
  }
}
function N0(e, r) {
  e.position && (r.position = vx(e));
}
function A0(e, r) {
  let i = r;
  if (e && e.data) {
    const o = e.data.hName, a = e.data.hChildren, s = e.data.hProperties;
    if (typeof o == "string")
      if (i.type === "element")
        i.tagName = o;
      else {
        const c = "children" in i ? i.children : [i];
        i = { type: "element", tagName: o, properties: {}, children: c };
      }
    i.type === "element" && s && Object.assign(i.properties, Rl(s)), "children" in i && i.children && a !== null && a !== void 0 && (i.children = a);
  }
  return i;
}
function z0(e, r) {
  const i = r.data || {}, o = "value" in r && !(au.call(i, "hProperties") || au.call(i, "hChildren")) ? { type: "text", value: r.value } : {
    type: "element",
    tagName: "div",
    properties: {},
    children: e.all(r)
  };
  return e.patch(r, o), e.applyData(r, o);
}
function P0(e, r) {
  const i = [];
  let o = -1;
  for (r && i.push({ type: "text", value: `
` }); ++o < e.length; )
    o && i.push({ type: "text", value: `
` }), i.push(e[o]);
  return r && e.length > 0 && i.push({ type: "text", value: `
` }), i;
}
function wp(e) {
  let r = 0, i = e.charCodeAt(r);
  for (; i === 9 || i === 32; )
    r++, i = e.charCodeAt(r);
  return e.slice(r);
}
function bp(e, r) {
  const i = L0(e, r), o = i.one(e, void 0), a = k0(i), s = Array.isArray(o) ? { type: "root", children: o } : o || { type: "root", children: [] };
  return a && s.children.push({ type: "text", value: `
` }, a), s;
}
function I0(e, r) {
  return e && "run" in e ? async function(i, o) {
    const a = (
      /** @type {HastRoot} */
      bp(i, { file: o, ...r })
    );
    await e.run(a, o);
  } : function(i, o) {
    return (
      /** @type {HastRoot} */
      bp(i, { file: o, ...e || r })
    );
  };
}
function Sp(e) {
  if (e)
    throw e;
}
var Is, Cp;
function D0() {
  if (Cp) return Is;
  Cp = 1;
  var e = Object.prototype.hasOwnProperty, r = Object.prototype.toString, i = Object.defineProperty, o = Object.getOwnPropertyDescriptor, a = function(h) {
    return typeof Array.isArray == "function" ? Array.isArray(h) : r.call(h) === "[object Array]";
  }, s = function(h) {
    if (!h || r.call(h) !== "[object Object]")
      return !1;
    var m = e.call(h, "constructor"), v = h.constructor && h.constructor.prototype && e.call(h.constructor.prototype, "isPrototypeOf");
    if (h.constructor && !m && !v)
      return !1;
    var w;
    for (w in h)
      ;
    return typeof w > "u" || e.call(h, w);
  }, c = function(h, m) {
    i && m.name === "__proto__" ? i(h, m.name, {
      enumerable: !0,
      configurable: !0,
      value: m.newValue,
      writable: !0
    }) : h[m.name] = m.newValue;
  }, d = function(h, m) {
    if (m === "__proto__")
      if (e.call(h, m)) {
        if (o)
          return o(h, m).value;
      } else return;
    return h[m];
  };
  return Is = function p() {
    var h, m, v, w, x, E, L = arguments[0], D = 1, z = arguments.length, U = !1;
    for (typeof L == "boolean" && (U = L, L = arguments[1] || {}, D = 2), (L == null || typeof L != "object" && typeof L != "function") && (L = {}); D < z; ++D)
      if (h = arguments[D], h != null)
        for (m in h)
          v = d(L, m), w = d(h, m), L !== w && (U && w && (s(w) || (x = a(w))) ? (x ? (x = !1, E = v && a(v) ? v : []) : E = v && s(v) ? v : {}, c(L, { name: m, newValue: p(U, E, w) })) : typeof w < "u" && c(L, { name: m, newValue: w }));
    return L;
  }, Is;
}
var M0 = D0();
const Ds = /* @__PURE__ */ yu(M0);
function su(e) {
  if (typeof e != "object" || e === null)
    return !1;
  const r = Object.getPrototypeOf(e);
  return (r === null || r === Object.prototype || Object.getPrototypeOf(r) === null) && !(Symbol.toStringTag in e) && !(Symbol.iterator in e);
}
function O0() {
  const e = [], r = { run: i, use: o };
  return r;
  function i(...a) {
    let s = -1;
    const c = a.pop();
    if (typeof c != "function")
      throw new TypeError("Expected function as last argument, not " + c);
    d(null, ...a);
    function d(p, ...h) {
      const m = e[++s];
      let v = -1;
      if (p) {
        c(p);
        return;
      }
      for (; ++v < a.length; )
        (h[v] === null || h[v] === void 0) && (h[v] = a[v]);
      a = h, m ? F0(m, d)(...h) : c(null, ...h);
    }
  }
  function o(a) {
    if (typeof a != "function")
      throw new TypeError(
        "Expected `middelware` to be a function, not " + a
      );
    return e.push(a), r;
  }
}
function F0(e, r) {
  let i;
  return o;
  function o(...c) {
    const d = e.length > c.length;
    let p;
    d && c.push(a);
    try {
      p = e.apply(this, c);
    } catch (h) {
      const m = (
        /** @type {Error} */
        h
      );
      if (d && i)
        throw m;
      return a(m);
    }
    d || (p && p.then && typeof p.then == "function" ? p.then(s, a) : p instanceof Error ? a(p) : s(p));
  }
  function a(c, ...d) {
    i || (i = !0, r(c, ...d));
  }
  function s(c) {
    a(null, c);
  }
}
const xn = { basename: $0, dirname: B0, extname: H0, join: q0, sep: "/" };
function $0(e, r) {
  if (r !== void 0 && typeof r != "string")
    throw new TypeError('"ext" argument must be a string');
  so(e);
  let i = 0, o = -1, a = e.length, s;
  if (r === void 0 || r.length === 0 || r.length > e.length) {
    for (; a--; )
      if (e.codePointAt(a) === 47) {
        if (s) {
          i = a + 1;
          break;
        }
      } else o < 0 && (s = !0, o = a + 1);
    return o < 0 ? "" : e.slice(i, o);
  }
  if (r === e)
    return "";
  let c = -1, d = r.length - 1;
  for (; a--; )
    if (e.codePointAt(a) === 47) {
      if (s) {
        i = a + 1;
        break;
      }
    } else
      c < 0 && (s = !0, c = a + 1), d > -1 && (e.codePointAt(a) === r.codePointAt(d--) ? d < 0 && (o = a) : (d = -1, o = c));
  return i === o ? o = c : o < 0 && (o = e.length), e.slice(i, o);
}
function B0(e) {
  if (so(e), e.length === 0)
    return ".";
  let r = -1, i = e.length, o;
  for (; --i; )
    if (e.codePointAt(i) === 47) {
      if (o) {
        r = i;
        break;
      }
    } else o || (o = !0);
  return r < 0 ? e.codePointAt(0) === 47 ? "/" : "." : r === 1 && e.codePointAt(0) === 47 ? "//" : e.slice(0, r);
}
function H0(e) {
  so(e);
  let r = e.length, i = -1, o = 0, a = -1, s = 0, c;
  for (; r--; ) {
    const d = e.codePointAt(r);
    if (d === 47) {
      if (c) {
        o = r + 1;
        break;
      }
      continue;
    }
    i < 0 && (c = !0, i = r + 1), d === 46 ? a < 0 ? a = r : s !== 1 && (s = 1) : a > -1 && (s = -1);
  }
  return a < 0 || i < 0 || // We saw a non-dot character immediately before the dot.
  s === 0 || // The (right-most) trimmed path component is exactly `..`.
  s === 1 && a === i - 1 && a === o + 1 ? "" : e.slice(a, i);
}
function q0(...e) {
  let r = -1, i;
  for (; ++r < e.length; )
    so(e[r]), e[r] && (i = i === void 0 ? e[r] : i + "/" + e[r]);
  return i === void 0 ? "." : U0(i);
}
function U0(e) {
  so(e);
  const r = e.codePointAt(0) === 47;
  let i = W0(e, !r);
  return i.length === 0 && !r && (i = "."), i.length > 0 && e.codePointAt(e.length - 1) === 47 && (i += "/"), r ? "/" + i : i;
}
function W0(e, r) {
  let i = "", o = 0, a = -1, s = 0, c = -1, d, p;
  for (; ++c <= e.length; ) {
    if (c < e.length)
      d = e.codePointAt(c);
    else {
      if (d === 47)
        break;
      d = 47;
    }
    if (d === 47) {
      if (!(a === c - 1 || s === 1)) if (a !== c - 1 && s === 2) {
        if (i.length < 2 || o !== 2 || i.codePointAt(i.length - 1) !== 46 || i.codePointAt(i.length - 2) !== 46) {
          if (i.length > 2) {
            if (p = i.lastIndexOf("/"), p !== i.length - 1) {
              p < 0 ? (i = "", o = 0) : (i = i.slice(0, p), o = i.length - 1 - i.lastIndexOf("/")), a = c, s = 0;
              continue;
            }
          } else if (i.length > 0) {
            i = "", o = 0, a = c, s = 0;
            continue;
          }
        }
        r && (i = i.length > 0 ? i + "/.." : "..", o = 2);
      } else
        i.length > 0 ? i += "/" + e.slice(a + 1, c) : i = e.slice(a + 1, c), o = c - a - 1;
      a = c, s = 0;
    } else d === 46 && s > -1 ? s++ : s = -1;
  }
  return i;
}
function so(e) {
  if (typeof e != "string")
    throw new TypeError(
      "Path must be a string. Received " + JSON.stringify(e)
    );
}
const V0 = { cwd: G0 };
function G0() {
  return "/";
}
function uu(e) {
  return !!(e !== null && typeof e == "object" && "href" in e && e.href && "protocol" in e && e.protocol && // @ts-expect-error: indexing is fine.
  e.auth === void 0);
}
function Q0(e) {
  if (typeof e == "string")
    e = new URL(e);
  else if (!uu(e)) {
    const r = new TypeError(
      'The "path" argument must be of type string or an instance of URL. Received `' + e + "`"
    );
    throw r.code = "ERR_INVALID_ARG_TYPE", r;
  }
  if (e.protocol !== "file:") {
    const r = new TypeError("The URL must be of scheme file");
    throw r.code = "ERR_INVALID_URL_SCHEME", r;
  }
  return K0(e);
}
function K0(e) {
  if (e.hostname !== "") {
    const o = new TypeError(
      'File URL host must be "localhost" or empty on darwin'
    );
    throw o.code = "ERR_INVALID_FILE_URL_HOST", o;
  }
  const r = e.pathname;
  let i = -1;
  for (; ++i < r.length; )
    if (r.codePointAt(i) === 37 && r.codePointAt(i + 1) === 50) {
      const o = r.codePointAt(i + 2);
      if (o === 70 || o === 102) {
        const a = new TypeError(
          "File URL path must not include encoded / characters"
        );
        throw a.code = "ERR_INVALID_FILE_URL_PATH", a;
      }
    }
  return decodeURIComponent(r);
}
const Ms = (
  /** @type {const} */
  [
    "history",
    "path",
    "basename",
    "stem",
    "extname",
    "dirname"
  ]
);
class Wh {
  /**
   * Create a new virtual file.
   *
   * `options` is treated as:
   *
   * *   `string` or `Uint8Array` — `{value: options}`
   * *   `URL` — `{path: options}`
   * *   `VFile` — shallow copies its data over to the new file
   * *   `object` — all fields are shallow copied over to the new file
   *
   * Path related fields are set in the following order (least specific to
   * most specific): `history`, `path`, `basename`, `stem`, `extname`,
   * `dirname`.
   *
   * You cannot set `dirname` or `extname` without setting either `history`,
   * `path`, `basename`, or `stem` too.
   *
   * @param {Compatible | null | undefined} [value]
   *   File value.
   * @returns
   *   New instance.
   */
  constructor(r) {
    let i;
    r ? uu(r) ? i = { path: r } : typeof r == "string" || Y0(r) ? i = { value: r } : i = r : i = {}, this.cwd = "cwd" in i ? "" : V0.cwd(), this.data = {}, this.history = [], this.messages = [], this.value, this.map, this.result, this.stored;
    let o = -1;
    for (; ++o < Ms.length; ) {
      const s = Ms[o];
      s in i && i[s] !== void 0 && i[s] !== null && (this[s] = s === "history" ? [...i[s]] : i[s]);
    }
    let a;
    for (a in i)
      Ms.includes(a) || (this[a] = i[a]);
  }
  /**
   * Get the basename (including extname) (example: `'index.min.js'`).
   *
   * @returns {string | undefined}
   *   Basename.
   */
  get basename() {
    return typeof this.path == "string" ? xn.basename(this.path) : void 0;
  }
  /**
   * Set basename (including extname) (`'index.min.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} basename
   *   Basename.
   * @returns {undefined}
   *   Nothing.
   */
  set basename(r) {
    Fs(r, "basename"), Os(r, "basename"), this.path = xn.join(this.dirname || "", r);
  }
  /**
   * Get the parent path (example: `'~'`).
   *
   * @returns {string | undefined}
   *   Dirname.
   */
  get dirname() {
    return typeof this.path == "string" ? xn.dirname(this.path) : void 0;
  }
  /**
   * Set the parent path (example: `'~'`).
   *
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} dirname
   *   Dirname.
   * @returns {undefined}
   *   Nothing.
   */
  set dirname(r) {
    Ep(this.basename, "dirname"), this.path = xn.join(r || "", this.basename);
  }
  /**
   * Get the extname (including dot) (example: `'.js'`).
   *
   * @returns {string | undefined}
   *   Extname.
   */
  get extname() {
    return typeof this.path == "string" ? xn.extname(this.path) : void 0;
  }
  /**
   * Set the extname (including dot) (example: `'.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} extname
   *   Extname.
   * @returns {undefined}
   *   Nothing.
   */
  set extname(r) {
    if (Os(r, "extname"), Ep(this.dirname, "extname"), r) {
      if (r.codePointAt(0) !== 46)
        throw new Error("`extname` must start with `.`");
      if (r.includes(".", 1))
        throw new Error("`extname` cannot contain multiple dots");
    }
    this.path = xn.join(this.dirname, this.stem + (r || ""));
  }
  /**
   * Get the full path (example: `'~/index.min.js'`).
   *
   * @returns {string}
   *   Path.
   */
  get path() {
    return this.history[this.history.length - 1];
  }
  /**
   * Set the full path (example: `'~/index.min.js'`).
   *
   * Cannot be nullified.
   * You can set a file URL (a `URL` object with a `file:` protocol) which will
   * be turned into a path with `url.fileURLToPath`.
   *
   * @param {URL | string} path
   *   Path.
   * @returns {undefined}
   *   Nothing.
   */
  set path(r) {
    uu(r) && (r = Q0(r)), Fs(r, "path"), this.path !== r && this.history.push(r);
  }
  /**
   * Get the stem (basename w/o extname) (example: `'index.min'`).
   *
   * @returns {string | undefined}
   *   Stem.
   */
  get stem() {
    return typeof this.path == "string" ? xn.basename(this.path, this.extname) : void 0;
  }
  /**
   * Set the stem (basename w/o extname) (example: `'index.min'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} stem
   *   Stem.
   * @returns {undefined}
   *   Nothing.
   */
  set stem(r) {
    Fs(r, "stem"), Os(r, "stem"), this.path = xn.join(this.dirname || "", r + (this.extname || ""));
  }
  // Normal prototypal methods.
  /**
   * Create a fatal message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `true` (error; file not usable)
   * and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {never}
   *   Never.
   * @throws {VFileMessage}
   *   Message.
   */
  fail(r, i, o) {
    const a = this.message(r, i, o);
    throw a.fatal = !0, a;
  }
  /**
   * Create an info message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `undefined` (info; change
   * likely not needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  info(r, i, o) {
    const a = this.message(r, i, o);
    return a.fatal = void 0, a;
  }
  /**
   * Create a message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `false` (warning; change may be
   * needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  message(r, i, o) {
    const a = new bt(
      // @ts-expect-error: the overloads are fine.
      r,
      i,
      o
    );
    return this.path && (a.name = this.path + ":" + a.name, a.file = this.path), a.fatal = !1, this.messages.push(a), a;
  }
  /**
   * Serialize the file.
   *
   * > **Note**: which encodings are supported depends on the engine.
   * > For info on Node.js, see:
   * > <https://nodejs.org/api/util.html#whatwg-supported-encodings>.
   *
   * @param {string | null | undefined} [encoding='utf8']
   *   Character encoding to understand `value` as when it’s a `Uint8Array`
   *   (default: `'utf-8'`).
   * @returns {string}
   *   Serialized file.
   */
  toString(r) {
    return this.value === void 0 ? "" : typeof this.value == "string" ? this.value : new TextDecoder(r || void 0).decode(this.value);
  }
}
function Os(e, r) {
  if (e && e.includes(xn.sep))
    throw new Error(
      "`" + r + "` cannot be a path: did not expect `" + xn.sep + "`"
    );
}
function Fs(e, r) {
  if (!e)
    throw new Error("`" + r + "` cannot be empty");
}
function Ep(e, r) {
  if (!e)
    throw new Error("Setting `" + r + "` requires `path` to be set too");
}
function Y0(e) {
  return !!(e && typeof e == "object" && "byteLength" in e && "byteOffset" in e);
}
const X0 = (
  /**
   * @type {new <Parameters extends Array<unknown>, Result>(property: string | symbol) => (...parameters: Parameters) => Result}
   */
  /** @type {unknown} */
  /**
   * @this {Function}
   * @param {string | symbol} property
   * @returns {(...parameters: Array<unknown>) => unknown}
   */
  (function(e) {
    const o = (
      /** @type {Record<string | symbol, Function>} */
      // Prototypes do exist.
      // type-coverage:ignore-next-line
      this.constructor.prototype
    ), a = o[e], s = function() {
      return a.apply(s, arguments);
    };
    return Object.setPrototypeOf(s, o), s;
  })
), J0 = {}.hasOwnProperty;
class Ou extends X0 {
  /**
   * Create a processor.
   */
  constructor() {
    super("copy"), this.Compiler = void 0, this.Parser = void 0, this.attachers = [], this.compiler = void 0, this.freezeIndex = -1, this.frozen = void 0, this.namespace = {}, this.parser = void 0, this.transformers = O0();
  }
  /**
   * Copy a processor.
   *
   * @deprecated
   *   This is a private internal method and should not be used.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   New *unfrozen* processor ({@linkcode Processor}) that is
   *   configured to work the same as its ancestor.
   *   When the descendant processor is configured in the future it does not
   *   affect the ancestral processor.
   */
  copy() {
    const r = (
      /** @type {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>} */
      new Ou()
    );
    let i = -1;
    for (; ++i < this.attachers.length; ) {
      const o = this.attachers[i];
      r.use(...o);
    }
    return r.data(Ds(!0, {}, this.namespace)), r;
  }
  /**
   * Configure the processor with info available to all plugins.
   * Information is stored in an object.
   *
   * Typically, options can be given to a specific plugin, but sometimes it
   * makes sense to have information shared with several plugins.
   * For example, a list of HTML elements that are self-closing, which is
   * needed during all phases.
   *
   * > **Note**: setting information cannot occur on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * > **Note**: to register custom data in TypeScript, augment the
   * > {@linkcode Data} interface.
   *
   * @example
   *   This example show how to get and set info:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   const processor = unified().data('alpha', 'bravo')
   *
   *   processor.data('alpha') // => 'bravo'
   *
   *   processor.data() // => {alpha: 'bravo'}
   *
   *   processor.data({charlie: 'delta'})
   *
   *   processor.data() // => {charlie: 'delta'}
   *   ```
   *
   * @template {keyof Data} Key
   *
   * @overload
   * @returns {Data}
   *
   * @overload
   * @param {Data} dataset
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Key} key
   * @returns {Data[Key]}
   *
   * @overload
   * @param {Key} key
   * @param {Data[Key]} value
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @param {Data | Key} [key]
   *   Key to get or set, or entire dataset to set, or nothing to get the
   *   entire dataset (optional).
   * @param {Data[Key]} [value]
   *   Value to set (optional).
   * @returns {unknown}
   *   The current processor when setting, the value at `key` when getting, or
   *   the entire dataset when getting without key.
   */
  data(r, i) {
    return typeof r == "string" ? arguments.length === 2 ? (Hs("data", this.frozen), this.namespace[r] = i, this) : J0.call(this.namespace, r) && this.namespace[r] || void 0 : r ? (Hs("data", this.frozen), this.namespace = r, this) : this.namespace;
  }
  /**
   * Freeze a processor.
   *
   * Frozen processors are meant to be extended and not to be configured
   * directly.
   *
   * When a processor is frozen it cannot be unfrozen.
   * New processors working the same way can be created by calling the
   * processor.
   *
   * It’s possible to freeze processors explicitly by calling `.freeze()`.
   * Processors freeze automatically when `.parse()`, `.run()`, `.runSync()`,
   * `.stringify()`, `.process()`, or `.processSync()` are called.
   *
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   The current processor.
   */
  freeze() {
    if (this.frozen)
      return this;
    const r = (
      /** @type {Processor} */
      /** @type {unknown} */
      this
    );
    for (; ++this.freezeIndex < this.attachers.length; ) {
      const [i, ...o] = this.attachers[this.freezeIndex];
      if (o[0] === !1)
        continue;
      o[0] === !0 && (o[0] = void 0);
      const a = i.call(r, ...o);
      typeof a == "function" && this.transformers.use(a);
    }
    return this.frozen = !0, this.freezeIndex = Number.POSITIVE_INFINITY, this;
  }
  /**
   * Parse text to a syntax tree.
   *
   * > **Note**: `parse` freezes the processor if not already *frozen*.
   *
   * > **Note**: `parse` performs the parse phase, not the run phase or other
   * > phases.
   *
   * @param {Compatible | undefined} [file]
   *   file to parse (optional); typically `string` or `VFile`; any value
   *   accepted as `x` in `new VFile(x)`.
   * @returns {ParseTree extends undefined ? Node : ParseTree}
   *   Syntax tree representing `file`.
   */
  parse(r) {
    this.freeze();
    const i = wl(r), o = this.parser || this.Parser;
    return $s("parse", o), o(String(i), i);
  }
  /**
   * Process the given file as configured on the processor.
   *
   * > **Note**: `process` freezes the processor if not already *frozen*.
   *
   * > **Note**: `process` performs the parse, run, and stringify phases.
   *
   * @overload
   * @param {Compatible | undefined} file
   * @param {ProcessCallback<VFileWithOutput<CompileResult>>} done
   * @returns {undefined}
   *
   * @overload
   * @param {Compatible | undefined} [file]
   * @returns {Promise<VFileWithOutput<CompileResult>>}
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`]; any value accepted as
   *   `x` in `new VFile(x)`.
   * @param {ProcessCallback<VFileWithOutput<CompileResult>> | undefined} [done]
   *   Callback (optional).
   * @returns {Promise<VFile> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise a promise, rejected with a fatal error or resolved with the
   *   processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  process(r, i) {
    const o = this;
    return this.freeze(), $s("process", this.parser || this.Parser), Bs("process", this.compiler || this.Compiler), i ? a(void 0, i) : new Promise(a);
    function a(s, c) {
      const d = wl(r), p = (
        /** @type {HeadTree extends undefined ? Node : HeadTree} */
        /** @type {unknown} */
        o.parse(d)
      );
      o.run(p, d, function(m, v, w) {
        if (m || !v || !w)
          return h(m);
        const x = (
          /** @type {CompileTree extends undefined ? Node : CompileTree} */
          /** @type {unknown} */
          v
        ), E = o.stringify(x, w);
        tb(E) ? w.value = E : w.result = E, h(
          m,
          /** @type {VFileWithOutput<CompileResult>} */
          w
        );
      });
      function h(m, v) {
        m || !v ? c(m) : s ? s(v) : i(void 0, v);
      }
    }
  }
  /**
   * Process the given file as configured on the processor.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `processSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `processSync` performs the parse, run, and stringify phases.
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`; any value accepted as
   *   `x` in `new VFile(x)`.
   * @returns {VFileWithOutput<CompileResult>}
   *   The processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  processSync(r) {
    let i = !1, o;
    return this.freeze(), $s("processSync", this.parser || this.Parser), Bs("processSync", this.compiler || this.Compiler), this.process(r, a), Tp("processSync", "process", i), o;
    function a(s, c) {
      i = !0, Sp(s), o = c;
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * > **Note**: `run` freezes the processor if not already *frozen*.
   *
   * > **Note**: `run` performs the run phase, not other phases.
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} file
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} [file]
   * @returns {Promise<TailTree extends undefined ? Node : TailTree>}
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {(
   *   RunCallback<TailTree extends undefined ? Node : TailTree> |
   *   Compatible
   * )} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} [done]
   *   Callback (optional).
   * @returns {Promise<TailTree extends undefined ? Node : TailTree> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise, a promise rejected with a fatal error or resolved with the
   *   transformed tree.
   */
  run(r, i, o) {
    _p(r), this.freeze();
    const a = this.transformers;
    return !o && typeof i == "function" && (o = i, i = void 0), o ? s(void 0, o) : new Promise(s);
    function s(c, d) {
      const p = wl(i);
      a.run(r, p, h);
      function h(m, v, w) {
        const x = (
          /** @type {TailTree extends undefined ? Node : TailTree} */
          v || r
        );
        m ? d(m) : c ? c(x) : o(void 0, x, w);
      }
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `runSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `runSync` performs the run phase, not other phases.
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {TailTree extends undefined ? Node : TailTree}
   *   Transformed tree.
   */
  runSync(r, i) {
    let o = !1, a;
    return this.run(r, i, s), Tp("runSync", "run", o), a;
    function s(c, d) {
      Sp(c), a = d, o = !0;
    }
  }
  /**
   * Compile a syntax tree.
   *
   * > **Note**: `stringify` freezes the processor if not already *frozen*.
   *
   * > **Note**: `stringify` performs the stringify phase, not the run phase
   * > or other phases.
   *
   * @param {CompileTree extends undefined ? Node : CompileTree} tree
   *   Tree to compile.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {CompileResult extends undefined ? Value : CompileResult}
   *   Textual representation of the tree (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most compilers
   *   > return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  stringify(r, i) {
    this.freeze();
    const o = wl(i), a = this.compiler || this.Compiler;
    return Bs("stringify", a), _p(r), a(r, o);
  }
  /**
   * Configure the processor to use a plugin, a list of usable values, or a
   * preset.
   *
   * If the processor is already using a plugin, the previous plugin
   * configuration is changed based on the options that are passed in.
   * In other words, the plugin is not added a second time.
   *
   * > **Note**: `use` cannot be called on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * @example
   *   There are many ways to pass plugins to `.use()`.
   *   This example gives an overview:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   unified()
   *     // Plugin with options:
   *     .use(pluginA, {x: true, y: true})
   *     // Passing the same plugin again merges configuration (to `{x: true, y: false, z: true}`):
   *     .use(pluginA, {y: false, z: true})
   *     // Plugins:
   *     .use([pluginB, pluginC])
   *     // Two plugins, the second with options:
   *     .use([pluginD, [pluginE, {}]])
   *     // Preset with plugins and settings:
   *     .use({plugins: [pluginF, [pluginG, {}]], settings: {position: false}})
   *     // Settings only:
   *     .use({settings: {position: false}})
   *   ```
   *
   * @template {Array<unknown>} [Parameters=[]]
   * @template {Node | string | undefined} [Input=undefined]
   * @template [Output=Input]
   *
   * @overload
   * @param {Preset | null | undefined} [preset]
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {PluggableList} list
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Plugin<Parameters, Input, Output>} plugin
   * @param {...(Parameters | [boolean])} parameters
   * @returns {UsePlugin<ParseTree, HeadTree, TailTree, CompileTree, CompileResult, Input, Output>}
   *
   * @param {PluggableList | Plugin | Preset | null | undefined} value
   *   Usable value.
   * @param {...unknown} parameters
   *   Parameters, when a plugin is given as a usable value.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   Current processor.
   */
  use(r, ...i) {
    const o = this.attachers, a = this.namespace;
    if (Hs("use", this.frozen), r != null) if (typeof r == "function")
      p(r, i);
    else if (typeof r == "object")
      Array.isArray(r) ? d(r) : c(r);
    else
      throw new TypeError("Expected usable value, not `" + r + "`");
    return this;
    function s(h) {
      if (typeof h == "function")
        p(h, []);
      else if (typeof h == "object")
        if (Array.isArray(h)) {
          const [m, ...v] = (
            /** @type {PluginTuple<Array<unknown>>} */
            h
          );
          p(m, v);
        } else
          c(h);
      else
        throw new TypeError("Expected usable value, not `" + h + "`");
    }
    function c(h) {
      if (!("plugins" in h) && !("settings" in h))
        throw new Error(
          "Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither"
        );
      d(h.plugins), h.settings && (a.settings = Ds(!0, a.settings, h.settings));
    }
    function d(h) {
      let m = -1;
      if (h != null) if (Array.isArray(h))
        for (; ++m < h.length; ) {
          const v = h[m];
          s(v);
        }
      else
        throw new TypeError("Expected a list of plugins, not `" + h + "`");
    }
    function p(h, m) {
      let v = -1, w = -1;
      for (; ++v < o.length; )
        if (o[v][0] === h) {
          w = v;
          break;
        }
      if (w === -1)
        o.push([h, ...m]);
      else if (m.length > 0) {
        let [x, ...E] = m;
        const L = o[w][1];
        su(L) && su(x) && (x = Ds(!0, L, x)), o[w] = [h, x, ...E];
      }
    }
  }
}
const Z0 = new Ou().freeze();
function $s(e, r) {
  if (typeof r != "function")
    throw new TypeError("Cannot `" + e + "` without `parser`");
}
function Bs(e, r) {
  if (typeof r != "function")
    throw new TypeError("Cannot `" + e + "` without `compiler`");
}
function Hs(e, r) {
  if (r)
    throw new Error(
      "Cannot call `" + e + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`."
    );
}
function _p(e) {
  if (!su(e) || typeof e.type != "string")
    throw new TypeError("Expected node, got `" + e + "`");
}
function Tp(e, r, i) {
  if (!i)
    throw new Error(
      "`" + e + "` finished async. Use `" + r + "` instead"
    );
}
function wl(e) {
  return eb(e) ? e : new Wh(e);
}
function eb(e) {
  return !!(e && typeof e == "object" && "message" in e && "messages" in e);
}
function tb(e) {
  return typeof e == "string" || nb(e);
}
function nb(e) {
  return !!(e && typeof e == "object" && "byteLength" in e && "byteOffset" in e);
}
const rb = "https://github.com/remarkjs/react-markdown/blob/main/changelog.md", jp = [], Rp = { allowDangerousHtml: !0 }, ib = /^(https?|ircs?|mailto|xmpp)$/i, ob = [
  { from: "astPlugins", id: "remove-buggy-html-in-markdown-parser" },
  { from: "allowDangerousHtml", id: "remove-buggy-html-in-markdown-parser" },
  {
    from: "allowNode",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowElement"
  },
  {
    from: "allowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowedElements"
  },
  { from: "className", id: "remove-classname" },
  {
    from: "disallowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "disallowedElements"
  },
  { from: "escapeHtml", id: "remove-buggy-html-in-markdown-parser" },
  { from: "includeElementIndex", id: "#remove-includeelementindex" },
  {
    from: "includeNodeIndex",
    id: "change-includenodeindex-to-includeelementindex"
  },
  { from: "linkTarget", id: "remove-linktarget" },
  { from: "plugins", id: "change-plugins-to-remarkplugins", to: "remarkPlugins" },
  { from: "rawSourcePos", id: "#remove-rawsourcepos" },
  { from: "renderers", id: "change-renderers-to-components", to: "components" },
  { from: "source", id: "change-source-to-children", to: "children" },
  { from: "sourcePos", id: "#remove-sourcepos" },
  { from: "transformImageUri", id: "#add-urltransform", to: "urlTransform" },
  { from: "transformLinkUri", id: "#add-urltransform", to: "urlTransform" }
];
function Lp(e) {
  const r = lb(e), i = ab(e);
  return sb(r.runSync(r.parse(i), i), e);
}
function lb(e) {
  const r = e.rehypePlugins || jp, i = e.remarkPlugins || jp, o = e.remarkRehypeOptions ? { ...e.remarkRehypeOptions, ...Rp } : Rp;
  return Z0().use($w).use(i).use(I0, o).use(r);
}
function ab(e) {
  const r = e.children || "", i = new Wh();
  return typeof r == "string" && (i.value = r), i;
}
function sb(e, r) {
  const i = r.allowedElements, o = r.allowElement, a = r.components, s = r.disallowedElements, c = r.skipHtml, d = r.unwrapDisallowed, p = r.urlTransform || ub;
  for (const m of ob)
    Object.hasOwn(r, m.from) && ("" + m.from + (m.to ? "use `" + m.to + "` instead" : "remove it") + rb + m.id, void 0);
  return Mu(e, h), Sx(e, {
    Fragment: y.Fragment,
    components: a,
    ignoreInvalidStyle: !0,
    jsx: y.jsx,
    jsxs: y.jsxs,
    passKeys: !0,
    passNode: !0
  });
  function h(m, v, w) {
    if (m.type === "raw" && w && typeof v == "number")
      return c ? w.children.splice(v, 1) : w.children[v] = { type: "text", value: m.value }, v;
    if (m.type === "element") {
      let x;
      for (x in As)
        if (Object.hasOwn(As, x) && Object.hasOwn(m.properties, x)) {
          const E = m.properties[x], L = As[x];
          (L === null || L.includes(m.tagName)) && (m.properties[x] = p(String(E || ""), x, m));
        }
    }
    if (m.type === "element") {
      let x = i ? !i.includes(m.tagName) : s ? s.includes(m.tagName) : !1;
      if (!x && o && typeof v == "number" && (x = !o(m, v, w)), x && w && typeof v == "number")
        return d && m.children ? w.children.splice(v, 1, ...m.children) : w.children.splice(v, 1), v;
    }
  }
}
function ub(e) {
  const r = e.indexOf(":"), i = e.indexOf("?"), o = e.indexOf("#"), a = e.indexOf("/");
  return (
    // If there is no protocol, it’s relative.
    r === -1 || // If the first colon is after a `?`, `#`, or `/`, it’s not a protocol.
    a !== -1 && r > a || i !== -1 && r > i || o !== -1 && r > o || // It is a protocol, it should be allowed.
    ib.test(e.slice(0, r)) ? e : ""
  );
}
function Np(e, r) {
  const i = String(e);
  if (typeof r != "string")
    throw new TypeError("Expected character");
  let o = 0, a = i.indexOf(r);
  for (; a !== -1; )
    o++, a = i.indexOf(r, a + r.length);
  return o;
}
function cb(e) {
  if (typeof e != "string")
    throw new TypeError("Expected a string");
  return e.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
function db(e, r, i) {
  const a = Ol((i || {}).ignore || []), s = fb(r);
  let c = -1;
  for (; ++c < s.length; )
    Uh(e, "text", d);
  function d(h, m) {
    let v = -1, w;
    for (; ++v < m.length; ) {
      const x = m[v], E = w ? w.children : void 0;
      if (a(
        x,
        E ? E.indexOf(x) : void 0,
        w
      ))
        return;
      w = x;
    }
    if (w)
      return p(h, m);
  }
  function p(h, m) {
    const v = m[m.length - 1], w = s[c][0], x = s[c][1];
    let E = 0;
    const D = v.children.indexOf(h);
    let z = !1, U = [];
    w.lastIndex = 0;
    let B = w.exec(h.value);
    for (; B; ) {
      const ne = B.index, Z = {
        index: B.index,
        input: B.input,
        stack: [...m, h]
      };
      let j = x(...B, Z);
      if (typeof j == "string" && (j = j.length > 0 ? { type: "text", value: j } : void 0), j === !1 ? w.lastIndex = ne + 1 : (E !== ne && U.push({
        type: "text",
        value: h.value.slice(E, ne)
      }), Array.isArray(j) ? U.push(...j) : j && U.push(j), E = ne + B[0].length, z = !0), !w.global)
        break;
      B = w.exec(h.value);
    }
    return z ? (E < h.value.length && U.push({ type: "text", value: h.value.slice(E) }), v.children.splice(D, 1, ...U)) : U = [h], D + U.length;
  }
}
function fb(e) {
  const r = [];
  if (!Array.isArray(e))
    throw new TypeError("Expected find and replace tuple or list of tuples");
  const i = !e[0] || Array.isArray(e[0]) ? e : [e];
  let o = -1;
  for (; ++o < i.length; ) {
    const a = i[o];
    r.push([pb(a[0]), hb(a[1])]);
  }
  return r;
}
function pb(e) {
  return typeof e == "string" ? new RegExp(cb(e), "g") : e;
}
function hb(e) {
  return typeof e == "function" ? e : function() {
    return e;
  };
}
const qs = "phrasing", Us = ["autolink", "link", "image", "label"];
function mb() {
  return {
    transforms: [bb],
    enter: {
      literalAutolink: yb,
      literalAutolinkEmail: Ws,
      literalAutolinkHttp: Ws,
      literalAutolinkWww: Ws
    },
    exit: {
      literalAutolink: wb,
      literalAutolinkEmail: kb,
      literalAutolinkHttp: vb,
      literalAutolinkWww: xb
    }
  };
}
function gb() {
  return {
    unsafe: [
      {
        character: "@",
        before: "[+\\-.\\w]",
        after: "[\\-.\\w]",
        inConstruct: qs,
        notInConstruct: Us
      },
      {
        character: ".",
        before: "[Ww]",
        after: "[\\-.\\w]",
        inConstruct: qs,
        notInConstruct: Us
      },
      {
        character: ":",
        before: "[ps]",
        after: "\\/",
        inConstruct: qs,
        notInConstruct: Us
      }
    ]
  };
}
function yb(e) {
  this.enter({ type: "link", title: null, url: "", children: [] }, e);
}
function Ws(e) {
  this.config.enter.autolinkProtocol.call(this, e);
}
function vb(e) {
  this.config.exit.autolinkProtocol.call(this, e);
}
function xb(e) {
  this.config.exit.data.call(this, e);
  const r = this.stack[this.stack.length - 1];
  r.type, r.url = "http://" + this.sliceSerialize(e);
}
function kb(e) {
  this.config.exit.autolinkEmail.call(this, e);
}
function wb(e) {
  this.exit(e);
}
function bb(e) {
  db(
    e,
    [
      [/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, Sb],
      [new RegExp("(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)", "gu"), Cb]
    ],
    { ignore: ["link", "linkReference"] }
  );
}
function Sb(e, r, i, o, a) {
  let s = "";
  if (!Vh(a) || (/^w/i.test(r) && (i = r + i, r = "", s = "http://"), !Eb(i)))
    return !1;
  const c = _b(i + o);
  if (!c[0]) return !1;
  const d = {
    type: "link",
    title: null,
    url: s + r + c[0],
    children: [{ type: "text", value: r + c[0] }]
  };
  return c[1] ? [d, { type: "text", value: c[1] }] : d;
}
function Cb(e, r, i, o) {
  return (
    // Not an expected previous character.
    !Vh(o, !0) || // Label ends in not allowed character.
    /[-\d_]$/.test(i) ? !1 : {
      type: "link",
      title: null,
      url: "mailto:" + r + "@" + i,
      children: [{ type: "text", value: r + "@" + i }]
    }
  );
}
function Eb(e) {
  const r = e.split(".");
  return !(r.length < 2 || r[r.length - 1] && (/_/.test(r[r.length - 1]) || !/[a-zA-Z\d]/.test(r[r.length - 1])) || r[r.length - 2] && (/_/.test(r[r.length - 2]) || !/[a-zA-Z\d]/.test(r[r.length - 2])));
}
function _b(e) {
  const r = /[!"&'),.:;<>?\]}]+$/.exec(e);
  if (!r)
    return [e, void 0];
  e = e.slice(0, r.index);
  let i = r[0], o = i.indexOf(")");
  const a = Np(e, "(");
  let s = Np(e, ")");
  for (; o !== -1 && a > s; )
    e += i.slice(0, o + 1), i = i.slice(o + 1), o = i.indexOf(")"), s++;
  return [e, i];
}
function Vh(e, r) {
  const i = e.input.charCodeAt(e.index - 1);
  return (e.index === 0 || _r(i) || Il(i)) && // If it’s an email, the previous character should not be a slash.
  (!r || i !== 47);
}
Gh.peek = Ib;
function Tb() {
  this.buffer();
}
function jb(e) {
  this.enter({ type: "footnoteReference", identifier: "", label: "" }, e);
}
function Rb() {
  this.buffer();
}
function Lb(e) {
  this.enter(
    { type: "footnoteDefinition", identifier: "", label: "", children: [] },
    e
  );
}
function Nb(e) {
  const r = this.resume(), i = this.stack[this.stack.length - 1];
  i.type, i.identifier = an(
    this.sliceSerialize(e)
  ).toLowerCase(), i.label = r;
}
function Ab(e) {
  this.exit(e);
}
function zb(e) {
  const r = this.resume(), i = this.stack[this.stack.length - 1];
  i.type, i.identifier = an(
    this.sliceSerialize(e)
  ).toLowerCase(), i.label = r;
}
function Pb(e) {
  this.exit(e);
}
function Ib() {
  return "[";
}
function Gh(e, r, i, o) {
  const a = i.createTracker(o);
  let s = a.move("[^");
  const c = i.enter("footnoteReference"), d = i.enter("reference");
  return s += a.move(
    i.safe(i.associationId(e), { after: "]", before: s })
  ), d(), c(), s += a.move("]"), s;
}
function Db() {
  return {
    enter: {
      gfmFootnoteCallString: Tb,
      gfmFootnoteCall: jb,
      gfmFootnoteDefinitionLabelString: Rb,
      gfmFootnoteDefinition: Lb
    },
    exit: {
      gfmFootnoteCallString: Nb,
      gfmFootnoteCall: Ab,
      gfmFootnoteDefinitionLabelString: zb,
      gfmFootnoteDefinition: Pb
    }
  };
}
function Mb(e) {
  let r = !1;
  return e && e.firstLineBlank && (r = !0), {
    handlers: { footnoteDefinition: i, footnoteReference: Gh },
    // This is on by default already.
    unsafe: [{ character: "[", inConstruct: ["label", "phrasing", "reference"] }]
  };
  function i(o, a, s, c) {
    const d = s.createTracker(c);
    let p = d.move("[^");
    const h = s.enter("footnoteDefinition"), m = s.enter("label");
    return p += d.move(
      s.safe(s.associationId(o), { before: p, after: "]" })
    ), m(), p += d.move("]:"), o.children && o.children.length > 0 && (d.shift(4), p += d.move(
      (r ? `
` : " ") + s.indentLines(
        s.containerFlow(o, d.current()),
        r ? Qh : Ob
      )
    )), h(), p;
  }
}
function Ob(e, r, i) {
  return r === 0 ? e : Qh(e, r, i);
}
function Qh(e, r, i) {
  return (i ? "" : "    ") + e;
}
const Fb = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe"
];
Kh.peek = Ub;
function $b() {
  return {
    canContainEols: ["delete"],
    enter: { strikethrough: Hb },
    exit: { strikethrough: qb }
  };
}
function Bb() {
  return {
    unsafe: [
      {
        character: "~",
        inConstruct: "phrasing",
        notInConstruct: Fb
      }
    ],
    handlers: { delete: Kh }
  };
}
function Hb(e) {
  this.enter({ type: "delete", children: [] }, e);
}
function qb(e) {
  this.exit(e);
}
function Kh(e, r, i, o) {
  const a = i.createTracker(o), s = i.enter("strikethrough");
  let c = a.move("~~");
  return c += i.containerPhrasing(e, {
    ...a.current(),
    before: c,
    after: "~"
  }), c += a.move("~~"), s(), c;
}
function Ub() {
  return "~";
}
function Wb(e) {
  return e.length;
}
function Vb(e, r) {
  const i = r || {}, o = (i.align || []).concat(), a = i.stringLength || Wb, s = [], c = [], d = [], p = [];
  let h = 0, m = -1;
  for (; ++m < e.length; ) {
    const L = [], D = [];
    let z = -1;
    for (e[m].length > h && (h = e[m].length); ++z < e[m].length; ) {
      const U = Gb(e[m][z]);
      if (i.alignDelimiters !== !1) {
        const B = a(U);
        D[z] = B, (p[z] === void 0 || B > p[z]) && (p[z] = B);
      }
      L.push(U);
    }
    c[m] = L, d[m] = D;
  }
  let v = -1;
  if (typeof o == "object" && "length" in o)
    for (; ++v < h; )
      s[v] = Ap(o[v]);
  else {
    const L = Ap(o);
    for (; ++v < h; )
      s[v] = L;
  }
  v = -1;
  const w = [], x = [];
  for (; ++v < h; ) {
    const L = s[v];
    let D = "", z = "";
    L === 99 ? (D = ":", z = ":") : L === 108 ? D = ":" : L === 114 && (z = ":");
    let U = i.alignDelimiters === !1 ? 1 : Math.max(
      1,
      p[v] - D.length - z.length
    );
    const B = D + "-".repeat(U) + z;
    i.alignDelimiters !== !1 && (U = D.length + U + z.length, U > p[v] && (p[v] = U), x[v] = U), w[v] = B;
  }
  c.splice(1, 0, w), d.splice(1, 0, x), m = -1;
  const E = [];
  for (; ++m < c.length; ) {
    const L = c[m], D = d[m];
    v = -1;
    const z = [];
    for (; ++v < h; ) {
      const U = L[v] || "";
      let B = "", ne = "";
      if (i.alignDelimiters !== !1) {
        const Z = p[v] - (D[v] || 0), j = s[v];
        j === 114 ? B = " ".repeat(Z) : j === 99 ? Z % 2 ? (B = " ".repeat(Z / 2 + 0.5), ne = " ".repeat(Z / 2 - 0.5)) : (B = " ".repeat(Z / 2), ne = B) : ne = " ".repeat(Z);
      }
      i.delimiterStart !== !1 && !v && z.push("|"), i.padding !== !1 && // Don’t add the opening space if we’re not aligning and the cell is
      // empty: there will be a closing space.
      !(i.alignDelimiters === !1 && U === "") && (i.delimiterStart !== !1 || v) && z.push(" "), i.alignDelimiters !== !1 && z.push(B), z.push(U), i.alignDelimiters !== !1 && z.push(ne), i.padding !== !1 && z.push(" "), (i.delimiterEnd !== !1 || v !== h - 1) && z.push("|");
    }
    E.push(
      i.delimiterEnd === !1 ? z.join("").replace(/ +$/, "") : z.join("")
    );
  }
  return E.join(`
`);
}
function Gb(e) {
  return e == null ? "" : String(e);
}
function Ap(e) {
  const r = typeof e == "string" ? e.codePointAt(0) : 0;
  return r === 67 || r === 99 ? 99 : r === 76 || r === 108 ? 108 : r === 82 || r === 114 ? 114 : 0;
}
function Qb(e, r, i, o) {
  const a = i.enter("blockquote"), s = i.createTracker(o);
  s.move("> "), s.shift(2);
  const c = i.indentLines(
    i.containerFlow(e, s.current()),
    Kb
  );
  return a(), c;
}
function Kb(e, r, i) {
  return ">" + (i ? "" : " ") + e;
}
function Yb(e, r) {
  return zp(e, r.inConstruct, !0) && !zp(e, r.notInConstruct, !1);
}
function zp(e, r, i) {
  if (typeof r == "string" && (r = [r]), !r || r.length === 0)
    return i;
  let o = -1;
  for (; ++o < r.length; )
    if (e.includes(r[o]))
      return !0;
  return !1;
}
function Pp(e, r, i, o) {
  let a = -1;
  for (; ++a < i.unsafe.length; )
    if (i.unsafe[a].character === `
` && Yb(i.stack, i.unsafe[a]))
      return /[ \t]/.test(o.before) ? "" : " ";
  return `\\
`;
}
function Xb(e, r) {
  const i = String(e);
  let o = i.indexOf(r), a = o, s = 0, c = 0;
  if (typeof r != "string")
    throw new TypeError("Expected substring");
  for (; o !== -1; )
    o === a ? ++s > c && (c = s) : s = 1, a = o + r.length, o = i.indexOf(r, a);
  return c;
}
function Jb(e, r) {
  return !!(r.options.fences === !1 && e.value && // If there’s no info…
  !e.lang && // And there’s a non-whitespace character…
  /[^ \r\n]/.test(e.value) && // And the value doesn’t start or end in a blank…
  !/^[\t ]*(?:[\r\n]|$)|(?:^|[\r\n])[\t ]*$/.test(e.value));
}
function Zb(e) {
  const r = e.options.fence || "`";
  if (r !== "`" && r !== "~")
    throw new Error(
      "Cannot serialize code with `" + r + "` for `options.fence`, expected `` ` `` or `~`"
    );
  return r;
}
function e1(e, r, i, o) {
  const a = Zb(i), s = e.value || "", c = a === "`" ? "GraveAccent" : "Tilde";
  if (Jb(e, i)) {
    const v = i.enter("codeIndented"), w = i.indentLines(s, t1);
    return v(), w;
  }
  const d = i.createTracker(o), p = a.repeat(Math.max(Xb(s, a) + 1, 3)), h = i.enter("codeFenced");
  let m = d.move(p);
  if (e.lang) {
    const v = i.enter(`codeFencedLang${c}`);
    m += d.move(
      i.safe(e.lang, {
        before: m,
        after: " ",
        encode: ["`"],
        ...d.current()
      })
    ), v();
  }
  if (e.lang && e.meta) {
    const v = i.enter(`codeFencedMeta${c}`);
    m += d.move(" "), m += d.move(
      i.safe(e.meta, {
        before: m,
        after: `
`,
        encode: ["`"],
        ...d.current()
      })
    ), v();
  }
  return m += d.move(`
`), s && (m += d.move(s + `
`)), m += d.move(p), h(), m;
}
function t1(e, r, i) {
  return (i ? "" : "    ") + e;
}
function Fu(e) {
  const r = e.options.quote || '"';
  if (r !== '"' && r !== "'")
    throw new Error(
      "Cannot serialize title with `" + r + "` for `options.quote`, expected `\"`, or `'`"
    );
  return r;
}
function n1(e, r, i, o) {
  const a = Fu(i), s = a === '"' ? "Quote" : "Apostrophe", c = i.enter("definition");
  let d = i.enter("label");
  const p = i.createTracker(o);
  let h = p.move("[");
  return h += p.move(
    i.safe(i.associationId(e), {
      before: h,
      after: "]",
      ...p.current()
    })
  ), h += p.move("]: "), d(), // If there’s no url, or…
  !e.url || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(e.url) ? (d = i.enter("destinationLiteral"), h += p.move("<"), h += p.move(
    i.safe(e.url, { before: h, after: ">", ...p.current() })
  ), h += p.move(">")) : (d = i.enter("destinationRaw"), h += p.move(
    i.safe(e.url, {
      before: h,
      after: e.title ? " " : `
`,
      ...p.current()
    })
  )), d(), e.title && (d = i.enter(`title${s}`), h += p.move(" " + a), h += p.move(
    i.safe(e.title, {
      before: h,
      after: a,
      ...p.current()
    })
  ), h += p.move(a), d()), c(), h;
}
function r1(e) {
  const r = e.options.emphasis || "*";
  if (r !== "*" && r !== "_")
    throw new Error(
      "Cannot serialize emphasis with `" + r + "` for `options.emphasis`, expected `*`, or `_`"
    );
  return r;
}
function eo(e) {
  return "&#x" + e.toString(16).toUpperCase() + ";";
}
function Ll(e, r, i) {
  const o = ni(e), a = ni(r);
  return o === void 0 ? a === void 0 ? (
    // Letter inside:
    // we have to encode *both* letters for `_` as it is looser.
    // it already forms for `*` (and GFMs `~`).
    i === "_" ? { inside: !0, outside: !0 } : { inside: !1, outside: !1 }
  ) : a === 1 ? (
    // Whitespace inside: encode both (letter, whitespace).
    { inside: !0, outside: !0 }
  ) : (
    // Punctuation inside: encode outer (letter)
    { inside: !1, outside: !0 }
  ) : o === 1 ? a === void 0 ? (
    // Letter inside: already forms.
    { inside: !1, outside: !1 }
  ) : a === 1 ? (
    // Whitespace inside: encode both (whitespace).
    { inside: !0, outside: !0 }
  ) : (
    // Punctuation inside: already forms.
    { inside: !1, outside: !1 }
  ) : a === void 0 ? (
    // Letter inside: already forms.
    { inside: !1, outside: !1 }
  ) : a === 1 ? (
    // Whitespace inside: encode inner (whitespace).
    { inside: !0, outside: !1 }
  ) : (
    // Punctuation inside: already forms.
    { inside: !1, outside: !1 }
  );
}
Yh.peek = i1;
function Yh(e, r, i, o) {
  const a = r1(i), s = i.enter("emphasis"), c = i.createTracker(o), d = c.move(a);
  let p = c.move(
    i.containerPhrasing(e, {
      after: a,
      before: d,
      ...c.current()
    })
  );
  const h = p.charCodeAt(0), m = Ll(
    o.before.charCodeAt(o.before.length - 1),
    h,
    a
  );
  m.inside && (p = eo(h) + p.slice(1));
  const v = p.charCodeAt(p.length - 1), w = Ll(o.after.charCodeAt(0), v, a);
  w.inside && (p = p.slice(0, -1) + eo(v));
  const x = c.move(a);
  return s(), i.attentionEncodeSurroundingInfo = {
    after: w.outside,
    before: m.outside
  }, d + p + x;
}
function i1(e, r, i) {
  return i.options.emphasis || "*";
}
function o1(e, r) {
  let i = !1;
  return Mu(e, function(o) {
    if ("value" in o && /\r?\n|\r/.test(o.value) || o.type === "break")
      return i = !0, lu;
  }), !!((!e.depth || e.depth < 3) && Lu(e) && (r.options.setext || i));
}
function l1(e, r, i, o) {
  const a = Math.max(Math.min(6, e.depth || 1), 1), s = i.createTracker(o);
  if (o1(e, i)) {
    const m = i.enter("headingSetext"), v = i.enter("phrasing"), w = i.containerPhrasing(e, {
      ...s.current(),
      before: `
`,
      after: `
`
    });
    return v(), m(), w + `
` + (a === 1 ? "=" : "-").repeat(
      // The whole size…
      w.length - // Minus the position of the character after the last EOL (or
      // 0 if there is none)…
      (Math.max(w.lastIndexOf("\r"), w.lastIndexOf(`
`)) + 1)
    );
  }
  const c = "#".repeat(a), d = i.enter("headingAtx"), p = i.enter("phrasing");
  s.move(c + " ");
  let h = i.containerPhrasing(e, {
    before: "# ",
    after: `
`,
    ...s.current()
  });
  return /^[\t ]/.test(h) && (h = eo(h.charCodeAt(0)) + h.slice(1)), h = h ? c + " " + h : c, i.options.closeAtx && (h += " " + c), p(), d(), h;
}
Xh.peek = a1;
function Xh(e) {
  return e.value || "";
}
function a1() {
  return "<";
}
Jh.peek = s1;
function Jh(e, r, i, o) {
  const a = Fu(i), s = a === '"' ? "Quote" : "Apostrophe", c = i.enter("image");
  let d = i.enter("label");
  const p = i.createTracker(o);
  let h = p.move("![");
  return h += p.move(
    i.safe(e.alt, { before: h, after: "]", ...p.current() })
  ), h += p.move("]("), d(), // If there’s no url but there is a title…
  !e.url && e.title || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(e.url) ? (d = i.enter("destinationLiteral"), h += p.move("<"), h += p.move(
    i.safe(e.url, { before: h, after: ">", ...p.current() })
  ), h += p.move(">")) : (d = i.enter("destinationRaw"), h += p.move(
    i.safe(e.url, {
      before: h,
      after: e.title ? " " : ")",
      ...p.current()
    })
  )), d(), e.title && (d = i.enter(`title${s}`), h += p.move(" " + a), h += p.move(
    i.safe(e.title, {
      before: h,
      after: a,
      ...p.current()
    })
  ), h += p.move(a), d()), h += p.move(")"), c(), h;
}
function s1() {
  return "!";
}
Zh.peek = u1;
function Zh(e, r, i, o) {
  const a = e.referenceType, s = i.enter("imageReference");
  let c = i.enter("label");
  const d = i.createTracker(o);
  let p = d.move("![");
  const h = i.safe(e.alt, {
    before: p,
    after: "]",
    ...d.current()
  });
  p += d.move(h + "]["), c();
  const m = i.stack;
  i.stack = [], c = i.enter("reference");
  const v = i.safe(i.associationId(e), {
    before: p,
    after: "]",
    ...d.current()
  });
  return c(), i.stack = m, s(), a === "full" || !h || h !== v ? p += d.move(v + "]") : a === "shortcut" ? p = p.slice(0, -1) : p += d.move("]"), p;
}
function u1() {
  return "!";
}
em.peek = c1;
function em(e, r, i) {
  let o = e.value || "", a = "`", s = -1;
  for (; new RegExp("(^|[^`])" + a + "([^`]|$)").test(o); )
    a += "`";
  for (/[^ \r\n]/.test(o) && (/^[ \r\n]/.test(o) && /[ \r\n]$/.test(o) || /^`|`$/.test(o)) && (o = " " + o + " "); ++s < i.unsafe.length; ) {
    const c = i.unsafe[s], d = i.compilePattern(c);
    let p;
    if (c.atBreak)
      for (; p = d.exec(o); ) {
        let h = p.index;
        o.charCodeAt(h) === 10 && o.charCodeAt(h - 1) === 13 && h--, o = o.slice(0, h) + " " + o.slice(p.index + 1);
      }
  }
  return a + o + a;
}
function c1() {
  return "`";
}
function tm(e, r) {
  const i = Lu(e);
  return !!(!r.options.resourceLink && // If there’s a url…
  e.url && // And there’s a no title…
  !e.title && // And the content of `node` is a single text node…
  e.children && e.children.length === 1 && e.children[0].type === "text" && // And if the url is the same as the content…
  (i === e.url || "mailto:" + i === e.url) && // And that starts w/ a protocol…
  /^[a-z][a-z+.-]+:/i.test(e.url) && // And that doesn’t contain ASCII control codes (character escapes and
  // references don’t work), space, or angle brackets…
  !/[\0- <>\u007F]/.test(e.url));
}
nm.peek = d1;
function nm(e, r, i, o) {
  const a = Fu(i), s = a === '"' ? "Quote" : "Apostrophe", c = i.createTracker(o);
  let d, p;
  if (tm(e, i)) {
    const m = i.stack;
    i.stack = [], d = i.enter("autolink");
    let v = c.move("<");
    return v += c.move(
      i.containerPhrasing(e, {
        before: v,
        after: ">",
        ...c.current()
      })
    ), v += c.move(">"), d(), i.stack = m, v;
  }
  d = i.enter("link"), p = i.enter("label");
  let h = c.move("[");
  return h += c.move(
    i.containerPhrasing(e, {
      before: h,
      after: "](",
      ...c.current()
    })
  ), h += c.move("]("), p(), // If there’s no url but there is a title…
  !e.url && e.title || // If there are control characters or whitespace.
  /[\0- \u007F]/.test(e.url) ? (p = i.enter("destinationLiteral"), h += c.move("<"), h += c.move(
    i.safe(e.url, { before: h, after: ">", ...c.current() })
  ), h += c.move(">")) : (p = i.enter("destinationRaw"), h += c.move(
    i.safe(e.url, {
      before: h,
      after: e.title ? " " : ")",
      ...c.current()
    })
  )), p(), e.title && (p = i.enter(`title${s}`), h += c.move(" " + a), h += c.move(
    i.safe(e.title, {
      before: h,
      after: a,
      ...c.current()
    })
  ), h += c.move(a), p()), h += c.move(")"), d(), h;
}
function d1(e, r, i) {
  return tm(e, i) ? "<" : "[";
}
rm.peek = f1;
function rm(e, r, i, o) {
  const a = e.referenceType, s = i.enter("linkReference");
  let c = i.enter("label");
  const d = i.createTracker(o);
  let p = d.move("[");
  const h = i.containerPhrasing(e, {
    before: p,
    after: "]",
    ...d.current()
  });
  p += d.move(h + "]["), c();
  const m = i.stack;
  i.stack = [], c = i.enter("reference");
  const v = i.safe(i.associationId(e), {
    before: p,
    after: "]",
    ...d.current()
  });
  return c(), i.stack = m, s(), a === "full" || !h || h !== v ? p += d.move(v + "]") : a === "shortcut" ? p = p.slice(0, -1) : p += d.move("]"), p;
}
function f1() {
  return "[";
}
function $u(e) {
  const r = e.options.bullet || "*";
  if (r !== "*" && r !== "+" && r !== "-")
    throw new Error(
      "Cannot serialize items with `" + r + "` for `options.bullet`, expected `*`, `+`, or `-`"
    );
  return r;
}
function p1(e) {
  const r = $u(e), i = e.options.bulletOther;
  if (!i)
    return r === "*" ? "-" : "*";
  if (i !== "*" && i !== "+" && i !== "-")
    throw new Error(
      "Cannot serialize items with `" + i + "` for `options.bulletOther`, expected `*`, `+`, or `-`"
    );
  if (i === r)
    throw new Error(
      "Expected `bullet` (`" + r + "`) and `bulletOther` (`" + i + "`) to be different"
    );
  return i;
}
function h1(e) {
  const r = e.options.bulletOrdered || ".";
  if (r !== "." && r !== ")")
    throw new Error(
      "Cannot serialize items with `" + r + "` for `options.bulletOrdered`, expected `.` or `)`"
    );
  return r;
}
function im(e) {
  const r = e.options.rule || "*";
  if (r !== "*" && r !== "-" && r !== "_")
    throw new Error(
      "Cannot serialize rules with `" + r + "` for `options.rule`, expected `*`, `-`, or `_`"
    );
  return r;
}
function m1(e, r, i, o) {
  const a = i.enter("list"), s = i.bulletCurrent;
  let c = e.ordered ? h1(i) : $u(i);
  const d = e.ordered ? c === "." ? ")" : "." : p1(i);
  let p = r && i.bulletLastUsed ? c === i.bulletLastUsed : !1;
  if (!e.ordered) {
    const m = e.children ? e.children[0] : void 0;
    if (
      // Bullet could be used as a thematic break marker:
      (c === "*" || c === "-") && // Empty first list item:
      m && (!m.children || !m.children[0]) && // Directly in two other list items:
      i.stack[i.stack.length - 1] === "list" && i.stack[i.stack.length - 2] === "listItem" && i.stack[i.stack.length - 3] === "list" && i.stack[i.stack.length - 4] === "listItem" && // That are each the first child.
      i.indexStack[i.indexStack.length - 1] === 0 && i.indexStack[i.indexStack.length - 2] === 0 && i.indexStack[i.indexStack.length - 3] === 0 && (p = !0), im(i) === c && m
    ) {
      let v = -1;
      for (; ++v < e.children.length; ) {
        const w = e.children[v];
        if (w && w.type === "listItem" && w.children && w.children[0] && w.children[0].type === "thematicBreak") {
          p = !0;
          break;
        }
      }
    }
  }
  p && (c = d), i.bulletCurrent = c;
  const h = i.containerFlow(e, o);
  return i.bulletLastUsed = c, i.bulletCurrent = s, a(), h;
}
function g1(e) {
  const r = e.options.listItemIndent || "one";
  if (r !== "tab" && r !== "one" && r !== "mixed")
    throw new Error(
      "Cannot serialize items with `" + r + "` for `options.listItemIndent`, expected `tab`, `one`, or `mixed`"
    );
  return r;
}
function y1(e, r, i, o) {
  const a = g1(i);
  let s = i.bulletCurrent || $u(i);
  r && r.type === "list" && r.ordered && (s = (typeof r.start == "number" && r.start > -1 ? r.start : 1) + (i.options.incrementListMarker === !1 ? 0 : r.children.indexOf(e)) + s);
  let c = s.length + 1;
  (a === "tab" || a === "mixed" && (r && r.type === "list" && r.spread || e.spread)) && (c = Math.ceil(c / 4) * 4);
  const d = i.createTracker(o);
  d.move(s + " ".repeat(c - s.length)), d.shift(c);
  const p = i.enter("listItem"), h = i.indentLines(
    i.containerFlow(e, d.current()),
    m
  );
  return p(), h;
  function m(v, w, x) {
    return w ? (x ? "" : " ".repeat(c)) + v : (x ? s : s + " ".repeat(c - s.length)) + v;
  }
}
function v1(e, r, i, o) {
  const a = i.enter("paragraph"), s = i.enter("phrasing"), c = i.containerPhrasing(e, o);
  return s(), a(), c;
}
const x1 = (
  /** @type {(node?: unknown) => node is Exclude<PhrasingContent, Html>} */
  Ol([
    "break",
    "delete",
    "emphasis",
    // To do: next major: removed since footnotes were added to GFM.
    "footnote",
    "footnoteReference",
    "image",
    "imageReference",
    "inlineCode",
    // Enabled by `mdast-util-math`:
    "inlineMath",
    "link",
    "linkReference",
    // Enabled by `mdast-util-mdx`:
    "mdxJsxTextElement",
    // Enabled by `mdast-util-mdx`:
    "mdxTextExpression",
    "strong",
    "text",
    // Enabled by `mdast-util-directive`:
    "textDirective"
  ])
);
function k1(e, r, i, o) {
  return (e.children.some(function(c) {
    return x1(c);
  }) ? i.containerPhrasing : i.containerFlow).call(i, e, o);
}
function w1(e) {
  const r = e.options.strong || "*";
  if (r !== "*" && r !== "_")
    throw new Error(
      "Cannot serialize strong with `" + r + "` for `options.strong`, expected `*`, or `_`"
    );
  return r;
}
om.peek = b1;
function om(e, r, i, o) {
  const a = w1(i), s = i.enter("strong"), c = i.createTracker(o), d = c.move(a + a);
  let p = c.move(
    i.containerPhrasing(e, {
      after: a,
      before: d,
      ...c.current()
    })
  );
  const h = p.charCodeAt(0), m = Ll(
    o.before.charCodeAt(o.before.length - 1),
    h,
    a
  );
  m.inside && (p = eo(h) + p.slice(1));
  const v = p.charCodeAt(p.length - 1), w = Ll(o.after.charCodeAt(0), v, a);
  w.inside && (p = p.slice(0, -1) + eo(v));
  const x = c.move(a + a);
  return s(), i.attentionEncodeSurroundingInfo = {
    after: w.outside,
    before: m.outside
  }, d + p + x;
}
function b1(e, r, i) {
  return i.options.strong || "*";
}
function S1(e, r, i, o) {
  return i.safe(e.value, o);
}
function C1(e) {
  const r = e.options.ruleRepetition || 3;
  if (r < 3)
    throw new Error(
      "Cannot serialize rules with repetition `" + r + "` for `options.ruleRepetition`, expected `3` or more"
    );
  return r;
}
function E1(e, r, i) {
  const o = (im(i) + (i.options.ruleSpaces ? " " : "")).repeat(C1(i));
  return i.options.ruleSpaces ? o.slice(0, -1) : o;
}
const lm = {
  blockquote: Qb,
  break: Pp,
  code: e1,
  definition: n1,
  emphasis: Yh,
  hardBreak: Pp,
  heading: l1,
  html: Xh,
  image: Jh,
  imageReference: Zh,
  inlineCode: em,
  link: nm,
  linkReference: rm,
  list: m1,
  listItem: y1,
  paragraph: v1,
  root: k1,
  strong: om,
  text: S1,
  thematicBreak: E1
};
function _1() {
  return {
    enter: {
      table: T1,
      tableData: Ip,
      tableHeader: Ip,
      tableRow: R1
    },
    exit: {
      codeText: L1,
      table: j1,
      tableData: Vs,
      tableHeader: Vs,
      tableRow: Vs
    }
  };
}
function T1(e) {
  const r = e._align;
  this.enter(
    {
      type: "table",
      align: r.map(function(i) {
        return i === "none" ? null : i;
      }),
      children: []
    },
    e
  ), this.data.inTable = !0;
}
function j1(e) {
  this.exit(e), this.data.inTable = void 0;
}
function R1(e) {
  this.enter({ type: "tableRow", children: [] }, e);
}
function Vs(e) {
  this.exit(e);
}
function Ip(e) {
  this.enter({ type: "tableCell", children: [] }, e);
}
function L1(e) {
  let r = this.resume();
  this.data.inTable && (r = r.replace(/\\([\\|])/g, N1));
  const i = this.stack[this.stack.length - 1];
  i.type, i.value = r, this.exit(e);
}
function N1(e, r) {
  return r === "|" ? r : e;
}
function A1(e) {
  const r = e || {}, i = r.tableCellPadding, o = r.tablePipeAlign, a = r.stringLength, s = i ? " " : "|";
  return {
    unsafe: [
      { character: "\r", inConstruct: "tableCell" },
      { character: `
`, inConstruct: "tableCell" },
      // A pipe, when followed by a tab or space (padding), or a dash or colon
      // (unpadded delimiter row), could result in a table.
      { atBreak: !0, character: "|", after: "[	 :-]" },
      // A pipe in a cell must be encoded.
      { character: "|", inConstruct: "tableCell" },
      // A colon must be followed by a dash, in which case it could start a
      // delimiter row.
      { atBreak: !0, character: ":", after: "-" },
      // A delimiter row can also start with a dash, when followed by more
      // dashes, a colon, or a pipe.
      // This is a stricter version than the built in check for lists, thematic
      // breaks, and setex heading underlines though:
      // <https://github.com/syntax-tree/mdast-util-to-markdown/blob/51a2038/lib/unsafe.js#L57>
      { atBreak: !0, character: "-", after: "[:|-]" }
    ],
    handlers: {
      inlineCode: w,
      table: c,
      tableCell: p,
      tableRow: d
    }
  };
  function c(x, E, L, D) {
    return h(m(x, L, D), x.align);
  }
  function d(x, E, L, D) {
    const z = v(x, L, D), U = h([z]);
    return U.slice(0, U.indexOf(`
`));
  }
  function p(x, E, L, D) {
    const z = L.enter("tableCell"), U = L.enter("phrasing"), B = L.containerPhrasing(x, {
      ...D,
      before: s,
      after: s
    });
    return U(), z(), B;
  }
  function h(x, E) {
    return Vb(x, {
      align: E,
      // @ts-expect-error: `markdown-table` types should support `null`.
      alignDelimiters: o,
      // @ts-expect-error: `markdown-table` types should support `null`.
      padding: i,
      // @ts-expect-error: `markdown-table` types should support `null`.
      stringLength: a
    });
  }
  function m(x, E, L) {
    const D = x.children;
    let z = -1;
    const U = [], B = E.enter("table");
    for (; ++z < D.length; )
      U[z] = v(D[z], E, L);
    return B(), U;
  }
  function v(x, E, L) {
    const D = x.children;
    let z = -1;
    const U = [], B = E.enter("tableRow");
    for (; ++z < D.length; )
      U[z] = p(D[z], x, E, L);
    return B(), U;
  }
  function w(x, E, L) {
    let D = lm.inlineCode(x, E, L);
    return L.stack.includes("tableCell") && (D = D.replace(/\|/g, "\\$&")), D;
  }
}
function z1() {
  return {
    exit: {
      taskListCheckValueChecked: Dp,
      taskListCheckValueUnchecked: Dp,
      paragraph: I1
    }
  };
}
function P1() {
  return {
    unsafe: [{ atBreak: !0, character: "-", after: "[:|-]" }],
    handlers: { listItem: D1 }
  };
}
function Dp(e) {
  const r = this.stack[this.stack.length - 2];
  r.type, r.checked = e.type === "taskListCheckValueChecked";
}
function I1(e) {
  const r = this.stack[this.stack.length - 2];
  if (r && r.type === "listItem" && typeof r.checked == "boolean") {
    const i = this.stack[this.stack.length - 1];
    i.type;
    const o = i.children[0];
    if (o && o.type === "text") {
      const a = r.children;
      let s = -1, c;
      for (; ++s < a.length; ) {
        const d = a[s];
        if (d.type === "paragraph") {
          c = d;
          break;
        }
      }
      c === i && (o.value = o.value.slice(1), o.value.length === 0 ? i.children.shift() : i.position && o.position && typeof o.position.start.offset == "number" && (o.position.start.column++, o.position.start.offset++, i.position.start = Object.assign({}, o.position.start)));
    }
  }
  this.exit(e);
}
function D1(e, r, i, o) {
  const a = e.children[0], s = typeof e.checked == "boolean" && a && a.type === "paragraph", c = "[" + (e.checked ? "x" : " ") + "] ", d = i.createTracker(o);
  s && d.move(c);
  let p = lm.listItem(e, r, i, {
    ...o,
    ...d.current()
  });
  return s && (p = p.replace(/^(?:[*+-]|\d+\.)([\r\n]| {1,3})/, h)), p;
  function h(m) {
    return m + c;
  }
}
function M1() {
  return [
    mb(),
    Db(),
    $b(),
    _1(),
    z1()
  ];
}
function O1(e) {
  return {
    extensions: [
      gb(),
      Mb(e),
      Bb(),
      A1(e),
      P1()
    ]
  };
}
const F1 = {
  tokenize: W1,
  partial: !0
}, am = {
  tokenize: V1,
  partial: !0
}, sm = {
  tokenize: G1,
  partial: !0
}, um = {
  tokenize: Q1,
  partial: !0
}, $1 = {
  tokenize: K1,
  partial: !0
}, cm = {
  name: "wwwAutolink",
  tokenize: q1,
  previous: fm
}, dm = {
  name: "protocolAutolink",
  tokenize: U1,
  previous: pm
}, Mn = {
  name: "emailAutolink",
  tokenize: H1,
  previous: hm
}, wn = {};
function B1() {
  return {
    text: wn
  };
}
let br = 48;
for (; br < 123; )
  wn[br] = Mn, br++, br === 58 ? br = 65 : br === 91 && (br = 97);
wn[43] = Mn;
wn[45] = Mn;
wn[46] = Mn;
wn[95] = Mn;
wn[72] = [Mn, dm];
wn[104] = [Mn, dm];
wn[87] = [Mn, cm];
wn[119] = [Mn, cm];
function H1(e, r, i) {
  const o = this;
  let a, s;
  return c;
  function c(v) {
    return !cu(v) || !hm.call(o, o.previous) || Bu(o.events) ? i(v) : (e.enter("literalAutolink"), e.enter("literalAutolinkEmail"), d(v));
  }
  function d(v) {
    return cu(v) ? (e.consume(v), d) : v === 64 ? (e.consume(v), p) : i(v);
  }
  function p(v) {
    return v === 46 ? e.check($1, m, h)(v) : v === 45 || v === 95 || wt(v) ? (s = !0, e.consume(v), p) : m(v);
  }
  function h(v) {
    return e.consume(v), a = !0, p;
  }
  function m(v) {
    return s && a && _t(o.previous) ? (e.exit("literalAutolinkEmail"), e.exit("literalAutolink"), r(v)) : i(v);
  }
}
function q1(e, r, i) {
  const o = this;
  return a;
  function a(c) {
    return c !== 87 && c !== 119 || !fm.call(o, o.previous) || Bu(o.events) ? i(c) : (e.enter("literalAutolink"), e.enter("literalAutolinkWww"), e.check(F1, e.attempt(am, e.attempt(sm, s), i), i)(c));
  }
  function s(c) {
    return e.exit("literalAutolinkWww"), e.exit("literalAutolink"), r(c);
  }
}
function U1(e, r, i) {
  const o = this;
  let a = "", s = !1;
  return c;
  function c(v) {
    return (v === 72 || v === 104) && pm.call(o, o.previous) && !Bu(o.events) ? (e.enter("literalAutolink"), e.enter("literalAutolinkHttp"), a += String.fromCodePoint(v), e.consume(v), d) : i(v);
  }
  function d(v) {
    if (_t(v) && a.length < 5)
      return a += String.fromCodePoint(v), e.consume(v), d;
    if (v === 58) {
      const w = a.toLowerCase();
      if (w === "http" || w === "https")
        return e.consume(v), p;
    }
    return i(v);
  }
  function p(v) {
    return v === 47 ? (e.consume(v), s ? h : (s = !0, p)) : i(v);
  }
  function h(v) {
    return v === null || Tl(v) || Ge(v) || _r(v) || Il(v) ? i(v) : e.attempt(am, e.attempt(sm, m), i)(v);
  }
  function m(v) {
    return e.exit("literalAutolinkHttp"), e.exit("literalAutolink"), r(v);
  }
}
function W1(e, r, i) {
  let o = 0;
  return a;
  function a(c) {
    return (c === 87 || c === 119) && o < 3 ? (o++, e.consume(c), a) : c === 46 && o === 3 ? (e.consume(c), s) : i(c);
  }
  function s(c) {
    return c === null ? i(c) : r(c);
  }
}
function V1(e, r, i) {
  let o, a, s;
  return c;
  function c(h) {
    return h === 46 || h === 95 ? e.check(um, p, d)(h) : h === null || Ge(h) || _r(h) || h !== 45 && Il(h) ? p(h) : (s = !0, e.consume(h), c);
  }
  function d(h) {
    return h === 95 ? o = !0 : (a = o, o = void 0), e.consume(h), c;
  }
  function p(h) {
    return a || o || !s ? i(h) : r(h);
  }
}
function G1(e, r) {
  let i = 0, o = 0;
  return a;
  function a(c) {
    return c === 40 ? (i++, e.consume(c), a) : c === 41 && o < i ? s(c) : c === 33 || c === 34 || c === 38 || c === 39 || c === 41 || c === 42 || c === 44 || c === 46 || c === 58 || c === 59 || c === 60 || c === 63 || c === 93 || c === 95 || c === 126 ? e.check(um, r, s)(c) : c === null || Ge(c) || _r(c) ? r(c) : (e.consume(c), a);
  }
  function s(c) {
    return c === 41 && o++, e.consume(c), a;
  }
}
function Q1(e, r, i) {
  return o;
  function o(d) {
    return d === 33 || d === 34 || d === 39 || d === 41 || d === 42 || d === 44 || d === 46 || d === 58 || d === 59 || d === 63 || d === 95 || d === 126 ? (e.consume(d), o) : d === 38 ? (e.consume(d), s) : d === 93 ? (e.consume(d), a) : (
      // `<` is an end.
      d === 60 || // So is whitespace.
      d === null || Ge(d) || _r(d) ? r(d) : i(d)
    );
  }
  function a(d) {
    return d === null || d === 40 || d === 91 || Ge(d) || _r(d) ? r(d) : o(d);
  }
  function s(d) {
    return _t(d) ? c(d) : i(d);
  }
  function c(d) {
    return d === 59 ? (e.consume(d), o) : _t(d) ? (e.consume(d), c) : i(d);
  }
}
function K1(e, r, i) {
  return o;
  function o(s) {
    return e.consume(s), a;
  }
  function a(s) {
    return wt(s) ? i(s) : r(s);
  }
}
function fm(e) {
  return e === null || e === 40 || e === 42 || e === 95 || e === 91 || e === 93 || e === 126 || Ge(e);
}
function pm(e) {
  return !_t(e);
}
function hm(e) {
  return !(e === 47 || cu(e));
}
function cu(e) {
  return e === 43 || e === 45 || e === 46 || e === 95 || wt(e);
}
function Bu(e) {
  let r = e.length, i = !1;
  for (; r--; ) {
    const o = e[r][1];
    if ((o.type === "labelLink" || o.type === "labelImage") && !o._balanced) {
      i = !0;
      break;
    }
    if (o._gfmAutolinkLiteralWalkedInto) {
      i = !1;
      break;
    }
  }
  return e.length > 0 && !i && (e[e.length - 1][1]._gfmAutolinkLiteralWalkedInto = !0), i;
}
const Y1 = {
  tokenize: iS,
  partial: !0
};
function X1() {
  return {
    document: {
      91: {
        name: "gfmFootnoteDefinition",
        tokenize: tS,
        continuation: {
          tokenize: nS
        },
        exit: rS
      }
    },
    text: {
      91: {
        name: "gfmFootnoteCall",
        tokenize: eS
      },
      93: {
        name: "gfmPotentialFootnoteCall",
        add: "after",
        tokenize: J1,
        resolveTo: Z1
      }
    }
  };
}
function J1(e, r, i) {
  const o = this;
  let a = o.events.length;
  const s = o.parser.gfmFootnotes || (o.parser.gfmFootnotes = []);
  let c;
  for (; a--; ) {
    const p = o.events[a][1];
    if (p.type === "labelImage") {
      c = p;
      break;
    }
    if (p.type === "gfmFootnoteCall" || p.type === "labelLink" || p.type === "label" || p.type === "image" || p.type === "link")
      break;
  }
  return d;
  function d(p) {
    if (!c || !c._balanced)
      return i(p);
    const h = an(o.sliceSerialize({
      start: c.end,
      end: o.now()
    }));
    return h.codePointAt(0) !== 94 || !s.includes(h.slice(1)) ? i(p) : (e.enter("gfmFootnoteCallLabelMarker"), e.consume(p), e.exit("gfmFootnoteCallLabelMarker"), r(p));
  }
}
function Z1(e, r) {
  let i = e.length;
  for (; i--; )
    if (e[i][1].type === "labelImage" && e[i][0] === "enter") {
      e[i][1];
      break;
    }
  e[i + 1][1].type = "data", e[i + 3][1].type = "gfmFootnoteCallLabelMarker";
  const o = {
    type: "gfmFootnoteCall",
    start: Object.assign({}, e[i + 3][1].start),
    end: Object.assign({}, e[e.length - 1][1].end)
  }, a = {
    type: "gfmFootnoteCallMarker",
    start: Object.assign({}, e[i + 3][1].end),
    end: Object.assign({}, e[i + 3][1].end)
  };
  a.end.column++, a.end.offset++, a.end._bufferIndex++;
  const s = {
    type: "gfmFootnoteCallString",
    start: Object.assign({}, a.end),
    end: Object.assign({}, e[e.length - 1][1].start)
  }, c = {
    type: "chunkString",
    contentType: "string",
    start: Object.assign({}, s.start),
    end: Object.assign({}, s.end)
  }, d = [
    // Take the `labelImageMarker` (now `data`, the `!`)
    e[i + 1],
    e[i + 2],
    ["enter", o, r],
    // The `[`
    e[i + 3],
    e[i + 4],
    // The `^`.
    ["enter", a, r],
    ["exit", a, r],
    // Everything in between.
    ["enter", s, r],
    ["enter", c, r],
    ["exit", c, r],
    ["exit", s, r],
    // The ending (`]`, properly parsed and labelled).
    e[e.length - 2],
    e[e.length - 1],
    ["exit", o, r]
  ];
  return e.splice(i, e.length - i + 1, ...d), e;
}
function eS(e, r, i) {
  const o = this, a = o.parser.gfmFootnotes || (o.parser.gfmFootnotes = []);
  let s = 0, c;
  return d;
  function d(v) {
    return e.enter("gfmFootnoteCall"), e.enter("gfmFootnoteCallLabelMarker"), e.consume(v), e.exit("gfmFootnoteCallLabelMarker"), p;
  }
  function p(v) {
    return v !== 94 ? i(v) : (e.enter("gfmFootnoteCallMarker"), e.consume(v), e.exit("gfmFootnoteCallMarker"), e.enter("gfmFootnoteCallString"), e.enter("chunkString").contentType = "string", h);
  }
  function h(v) {
    if (
      // Too long.
      s > 999 || // Closing brace with nothing.
      v === 93 && !c || // Space or tab is not supported by GFM for some reason.
      // `\n` and `[` not being supported makes sense.
      v === null || v === 91 || Ge(v)
    )
      return i(v);
    if (v === 93) {
      e.exit("chunkString");
      const w = e.exit("gfmFootnoteCallString");
      return a.includes(an(o.sliceSerialize(w))) ? (e.enter("gfmFootnoteCallLabelMarker"), e.consume(v), e.exit("gfmFootnoteCallLabelMarker"), e.exit("gfmFootnoteCall"), r) : i(v);
    }
    return Ge(v) || (c = !0), s++, e.consume(v), v === 92 ? m : h;
  }
  function m(v) {
    return v === 91 || v === 92 || v === 93 ? (e.consume(v), s++, h) : h(v);
  }
}
function tS(e, r, i) {
  const o = this, a = o.parser.gfmFootnotes || (o.parser.gfmFootnotes = []);
  let s, c = 0, d;
  return p;
  function p(E) {
    return e.enter("gfmFootnoteDefinition")._container = !0, e.enter("gfmFootnoteDefinitionLabel"), e.enter("gfmFootnoteDefinitionLabelMarker"), e.consume(E), e.exit("gfmFootnoteDefinitionLabelMarker"), h;
  }
  function h(E) {
    return E === 94 ? (e.enter("gfmFootnoteDefinitionMarker"), e.consume(E), e.exit("gfmFootnoteDefinitionMarker"), e.enter("gfmFootnoteDefinitionLabelString"), e.enter("chunkString").contentType = "string", m) : i(E);
  }
  function m(E) {
    if (
      // Too long.
      c > 999 || // Closing brace with nothing.
      E === 93 && !d || // Space or tab is not supported by GFM for some reason.
      // `\n` and `[` not being supported makes sense.
      E === null || E === 91 || Ge(E)
    )
      return i(E);
    if (E === 93) {
      e.exit("chunkString");
      const L = e.exit("gfmFootnoteDefinitionLabelString");
      return s = an(o.sliceSerialize(L)), e.enter("gfmFootnoteDefinitionLabelMarker"), e.consume(E), e.exit("gfmFootnoteDefinitionLabelMarker"), e.exit("gfmFootnoteDefinitionLabel"), w;
    }
    return Ge(E) || (d = !0), c++, e.consume(E), E === 92 ? v : m;
  }
  function v(E) {
    return E === 91 || E === 92 || E === 93 ? (e.consume(E), c++, m) : m(E);
  }
  function w(E) {
    return E === 58 ? (e.enter("definitionMarker"), e.consume(E), e.exit("definitionMarker"), a.includes(s) || a.push(s), Oe(e, x, "gfmFootnoteDefinitionWhitespace")) : i(E);
  }
  function x(E) {
    return r(E);
  }
}
function nS(e, r, i) {
  return e.check(ao, r, e.attempt(Y1, r, i));
}
function rS(e) {
  e.exit("gfmFootnoteDefinition");
}
function iS(e, r, i) {
  const o = this;
  return Oe(e, a, "gfmFootnoteDefinitionIndent", 5);
  function a(s) {
    const c = o.events[o.events.length - 1];
    return c && c[1].type === "gfmFootnoteDefinitionIndent" && c[2].sliceSerialize(c[1], !0).length === 4 ? r(s) : i(s);
  }
}
function oS(e) {
  let i = (e || {}).singleTilde;
  const o = {
    name: "strikethrough",
    tokenize: s,
    resolveAll: a
  };
  return i == null && (i = !0), {
    text: {
      126: o
    },
    insideSpan: {
      null: [o]
    },
    attentionMarkers: {
      null: [126]
    }
  };
  function a(c, d) {
    let p = -1;
    for (; ++p < c.length; )
      if (c[p][0] === "enter" && c[p][1].type === "strikethroughSequenceTemporary" && c[p][1]._close) {
        let h = p;
        for (; h--; )
          if (c[h][0] === "exit" && c[h][1].type === "strikethroughSequenceTemporary" && c[h][1]._open && // If the sizes are the same:
          c[p][1].end.offset - c[p][1].start.offset === c[h][1].end.offset - c[h][1].start.offset) {
            c[p][1].type = "strikethroughSequence", c[h][1].type = "strikethroughSequence";
            const m = {
              type: "strikethrough",
              start: Object.assign({}, c[h][1].start),
              end: Object.assign({}, c[p][1].end)
            }, v = {
              type: "strikethroughText",
              start: Object.assign({}, c[h][1].end),
              end: Object.assign({}, c[p][1].start)
            }, w = [["enter", m, d], ["enter", c[h][1], d], ["exit", c[h][1], d], ["enter", v, d]], x = d.parser.constructs.insideSpan.null;
            x && $t(w, w.length, 0, Dl(x, c.slice(h + 1, p), d)), $t(w, w.length, 0, [["exit", v, d], ["enter", c[p][1], d], ["exit", c[p][1], d], ["exit", m, d]]), $t(c, h - 1, p - h + 3, w), p = h + w.length - 2;
            break;
          }
      }
    for (p = -1; ++p < c.length; )
      c[p][1].type === "strikethroughSequenceTemporary" && (c[p][1].type = "data");
    return c;
  }
  function s(c, d, p) {
    const h = this.previous, m = this.events;
    let v = 0;
    return w;
    function w(E) {
      return h === 126 && m[m.length - 1][1].type !== "characterEscape" ? p(E) : (c.enter("strikethroughSequenceTemporary"), x(E));
    }
    function x(E) {
      const L = ni(h);
      if (E === 126)
        return v > 1 ? p(E) : (c.consume(E), v++, x);
      if (v < 2 && !i) return p(E);
      const D = c.exit("strikethroughSequenceTemporary"), z = ni(E);
      return D._open = !z || z === 2 && !!L, D._close = !L || L === 2 && !!z, d(E);
    }
  }
}
class lS {
  /**
   * Create a new edit map.
   */
  constructor() {
    this.map = [];
  }
  /**
   * Create an edit: a remove and/or add at a certain place.
   *
   * @param {number} index
   * @param {number} remove
   * @param {Array<Event>} add
   * @returns {undefined}
   */
  add(r, i, o) {
    aS(this, r, i, o);
  }
  // To do: add this when moving to `micromark`.
  // /**
  //  * Create an edit: but insert `add` before existing additions.
  //  *
  //  * @param {number} index
  //  * @param {number} remove
  //  * @param {Array<Event>} add
  //  * @returns {undefined}
  //  */
  // addBefore(index, remove, add) {
  //   addImplementation(this, index, remove, add, true)
  // }
  /**
   * Done, change the events.
   *
   * @param {Array<Event>} events
   * @returns {undefined}
   */
  consume(r) {
    if (this.map.sort(function(s, c) {
      return s[0] - c[0];
    }), this.map.length === 0)
      return;
    let i = this.map.length;
    const o = [];
    for (; i > 0; )
      i -= 1, o.push(r.slice(this.map[i][0] + this.map[i][1]), this.map[i][2]), r.length = this.map[i][0];
    o.push(r.slice()), r.length = 0;
    let a = o.pop();
    for (; a; ) {
      for (const s of a)
        r.push(s);
      a = o.pop();
    }
    this.map.length = 0;
  }
}
function aS(e, r, i, o) {
  let a = 0;
  if (!(i === 0 && o.length === 0)) {
    for (; a < e.map.length; ) {
      if (e.map[a][0] === r) {
        e.map[a][1] += i, e.map[a][2].push(...o);
        return;
      }
      a += 1;
    }
    e.map.push([r, i, o]);
  }
}
function sS(e, r) {
  let i = !1;
  const o = [];
  for (; r < e.length; ) {
    const a = e[r];
    if (i) {
      if (a[0] === "enter")
        a[1].type === "tableContent" && o.push(e[r + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
      else if (a[1].type === "tableContent") {
        if (e[r - 1][1].type === "tableDelimiterMarker") {
          const s = o.length - 1;
          o[s] = o[s] === "left" ? "center" : "right";
        }
      } else if (a[1].type === "tableDelimiterRow")
        break;
    } else a[0] === "enter" && a[1].type === "tableDelimiterRow" && (i = !0);
    r += 1;
  }
  return o;
}
function uS() {
  return {
    flow: {
      null: {
        name: "table",
        tokenize: cS,
        resolveAll: dS
      }
    }
  };
}
function cS(e, r, i) {
  const o = this;
  let a = 0, s = 0, c;
  return d;
  function d(I) {
    let te = o.events.length - 1;
    for (; te > -1; ) {
      const oe = o.events[te][1].type;
      if (oe === "lineEnding" || // Note: markdown-rs uses `whitespace` instead of `linePrefix`
      oe === "linePrefix") te--;
      else break;
    }
    const ie = te > -1 ? o.events[te][1].type : null, xe = ie === "tableHead" || ie === "tableRow" ? j : p;
    return xe === j && o.parser.lazy[o.now().line] ? i(I) : xe(I);
  }
  function p(I) {
    return e.enter("tableHead"), e.enter("tableRow"), h(I);
  }
  function h(I) {
    return I === 124 || (c = !0, s += 1), m(I);
  }
  function m(I) {
    return I === null ? i(I) : Se(I) ? s > 1 ? (s = 0, o.interrupt = !0, e.exit("tableRow"), e.enter("lineEnding"), e.consume(I), e.exit("lineEnding"), x) : i(I) : Pe(I) ? Oe(e, m, "whitespace")(I) : (s += 1, c && (c = !1, a += 1), I === 124 ? (e.enter("tableCellDivider"), e.consume(I), e.exit("tableCellDivider"), c = !0, m) : (e.enter("data"), v(I)));
  }
  function v(I) {
    return I === null || I === 124 || Ge(I) ? (e.exit("data"), m(I)) : (e.consume(I), I === 92 ? w : v);
  }
  function w(I) {
    return I === 92 || I === 124 ? (e.consume(I), v) : v(I);
  }
  function x(I) {
    return o.interrupt = !1, o.parser.lazy[o.now().line] ? i(I) : (e.enter("tableDelimiterRow"), c = !1, Pe(I) ? Oe(e, E, "linePrefix", o.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(I) : E(I));
  }
  function E(I) {
    return I === 45 || I === 58 ? D(I) : I === 124 ? (c = !0, e.enter("tableCellDivider"), e.consume(I), e.exit("tableCellDivider"), L) : Z(I);
  }
  function L(I) {
    return Pe(I) ? Oe(e, D, "whitespace")(I) : D(I);
  }
  function D(I) {
    return I === 58 ? (s += 1, c = !0, e.enter("tableDelimiterMarker"), e.consume(I), e.exit("tableDelimiterMarker"), z) : I === 45 ? (s += 1, z(I)) : I === null || Se(I) ? ne(I) : Z(I);
  }
  function z(I) {
    return I === 45 ? (e.enter("tableDelimiterFiller"), U(I)) : Z(I);
  }
  function U(I) {
    return I === 45 ? (e.consume(I), U) : I === 58 ? (c = !0, e.exit("tableDelimiterFiller"), e.enter("tableDelimiterMarker"), e.consume(I), e.exit("tableDelimiterMarker"), B) : (e.exit("tableDelimiterFiller"), B(I));
  }
  function B(I) {
    return Pe(I) ? Oe(e, ne, "whitespace")(I) : ne(I);
  }
  function ne(I) {
    return I === 124 ? E(I) : I === null || Se(I) ? !c || a !== s ? Z(I) : (e.exit("tableDelimiterRow"), e.exit("tableHead"), r(I)) : Z(I);
  }
  function Z(I) {
    return i(I);
  }
  function j(I) {
    return e.enter("tableRow"), Y(I);
  }
  function Y(I) {
    return I === 124 ? (e.enter("tableCellDivider"), e.consume(I), e.exit("tableCellDivider"), Y) : I === null || Se(I) ? (e.exit("tableRow"), r(I)) : Pe(I) ? Oe(e, Y, "whitespace")(I) : (e.enter("data"), se(I));
  }
  function se(I) {
    return I === null || I === 124 || Ge(I) ? (e.exit("data"), Y(I)) : (e.consume(I), I === 92 ? re : se);
  }
  function re(I) {
    return I === 92 || I === 124 ? (e.consume(I), se) : se(I);
  }
}
function dS(e, r) {
  let i = -1, o = !0, a = 0, s = [0, 0, 0, 0], c = [0, 0, 0, 0], d = !1, p = 0, h, m, v;
  const w = new lS();
  for (; ++i < e.length; ) {
    const x = e[i], E = x[1];
    x[0] === "enter" ? E.type === "tableHead" ? (d = !1, p !== 0 && (Mp(w, r, p, h, m), m = void 0, p = 0), h = {
      type: "table",
      start: Object.assign({}, E.start),
      // Note: correct end is set later.
      end: Object.assign({}, E.end)
    }, w.add(i, 0, [["enter", h, r]])) : E.type === "tableRow" || E.type === "tableDelimiterRow" ? (o = !0, v = void 0, s = [0, 0, 0, 0], c = [0, i + 1, 0, 0], d && (d = !1, m = {
      type: "tableBody",
      start: Object.assign({}, E.start),
      // Note: correct end is set later.
      end: Object.assign({}, E.end)
    }, w.add(i, 0, [["enter", m, r]])), a = E.type === "tableDelimiterRow" ? 2 : m ? 3 : 1) : a && (E.type === "data" || E.type === "tableDelimiterMarker" || E.type === "tableDelimiterFiller") ? (o = !1, c[2] === 0 && (s[1] !== 0 && (c[0] = c[1], v = bl(w, r, s, a, void 0, v), s = [0, 0, 0, 0]), c[2] = i)) : E.type === "tableCellDivider" && (o ? o = !1 : (s[1] !== 0 && (c[0] = c[1], v = bl(w, r, s, a, void 0, v)), s = c, c = [s[1], i, 0, 0])) : E.type === "tableHead" ? (d = !0, p = i) : E.type === "tableRow" || E.type === "tableDelimiterRow" ? (p = i, s[1] !== 0 ? (c[0] = c[1], v = bl(w, r, s, a, i, v)) : c[1] !== 0 && (v = bl(w, r, c, a, i, v)), a = 0) : a && (E.type === "data" || E.type === "tableDelimiterMarker" || E.type === "tableDelimiterFiller") && (c[3] = i);
  }
  for (p !== 0 && Mp(w, r, p, h, m), w.consume(r.events), i = -1; ++i < r.events.length; ) {
    const x = r.events[i];
    x[0] === "enter" && x[1].type === "table" && (x[1]._align = sS(r.events, i));
  }
  return e;
}
function bl(e, r, i, o, a, s) {
  const c = o === 1 ? "tableHeader" : o === 2 ? "tableDelimiter" : "tableData", d = "tableContent";
  i[0] !== 0 && (s.end = Object.assign({}, ti(r.events, i[0])), e.add(i[0], 0, [["exit", s, r]]));
  const p = ti(r.events, i[1]);
  if (s = {
    type: c,
    start: Object.assign({}, p),
    // Note: correct end is set later.
    end: Object.assign({}, p)
  }, e.add(i[1], 0, [["enter", s, r]]), i[2] !== 0) {
    const h = ti(r.events, i[2]), m = ti(r.events, i[3]), v = {
      type: d,
      start: Object.assign({}, h),
      end: Object.assign({}, m)
    };
    if (e.add(i[2], 0, [["enter", v, r]]), o !== 2) {
      const w = r.events[i[2]], x = r.events[i[3]];
      if (w[1].end = Object.assign({}, x[1].end), w[1].type = "chunkText", w[1].contentType = "text", i[3] > i[2] + 1) {
        const E = i[2] + 1, L = i[3] - i[2] - 1;
        e.add(E, L, []);
      }
    }
    e.add(i[3] + 1, 0, [["exit", v, r]]);
  }
  return a !== void 0 && (s.end = Object.assign({}, ti(r.events, a)), e.add(a, 0, [["exit", s, r]]), s = void 0), s;
}
function Mp(e, r, i, o, a) {
  const s = [], c = ti(r.events, i);
  a && (a.end = Object.assign({}, c), s.push(["exit", a, r])), o.end = Object.assign({}, c), s.push(["exit", o, r]), e.add(i + 1, 0, s);
}
function ti(e, r) {
  const i = e[r], o = i[0] === "enter" ? "start" : "end";
  return i[1][o];
}
const fS = {
  name: "tasklistCheck",
  tokenize: hS
};
function pS() {
  return {
    text: {
      91: fS
    }
  };
}
function hS(e, r, i) {
  const o = this;
  return a;
  function a(p) {
    return (
      // Exit if there’s stuff before.
      o.previous !== null || // Exit if not in the first content that is the first child of a list
      // item.
      !o._gfmTasklistFirstContentOfListItem ? i(p) : (e.enter("taskListCheck"), e.enter("taskListCheckMarker"), e.consume(p), e.exit("taskListCheckMarker"), s)
    );
  }
  function s(p) {
    return Ge(p) ? (e.enter("taskListCheckValueUnchecked"), e.consume(p), e.exit("taskListCheckValueUnchecked"), c) : p === 88 || p === 120 ? (e.enter("taskListCheckValueChecked"), e.consume(p), e.exit("taskListCheckValueChecked"), c) : i(p);
  }
  function c(p) {
    return p === 93 ? (e.enter("taskListCheckMarker"), e.consume(p), e.exit("taskListCheckMarker"), e.exit("taskListCheck"), d) : i(p);
  }
  function d(p) {
    return Se(p) ? r(p) : Pe(p) ? e.check({
      tokenize: mS
    }, r, i)(p) : i(p);
  }
}
function mS(e, r, i) {
  return Oe(e, o, "whitespace");
  function o(a) {
    return a === null ? i(a) : r(a);
  }
}
function gS(e) {
  return Eh([
    B1(),
    X1(),
    oS(e),
    uS(),
    pS()
  ]);
}
const yS = {};
function Op(e) {
  const r = (
    /** @type {Processor<Root>} */
    this
  ), i = e || yS, o = r.data(), a = o.micromarkExtensions || (o.micromarkExtensions = []), s = o.fromMarkdownExtensions || (o.fromMarkdownExtensions = []), c = o.toMarkdownExtensions || (o.toMarkdownExtensions = []);
  a.push(gS(i)), s.push(M1()), c.push(O1(i));
}
var mm = "think(?:ing)?|thought|antthinking|scratchpad|reasoning", vS = new RegExp(`<\\s*/?\\s*(?:${mm}|final)\\b`, "i"), Qi = /<\s*\/?\s*final\b[^<>]*>/gi, Fp = new RegExp(`<\\s*(/?)\\s*(?:${mm})\\b[^<>]*>`, "gi");
function gm(e) {
  const r = [], i = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2(?:\n|$)|$)/g;
  for (const a of e.matchAll(i)) {
    const s = a[1] ?? "", c = (a.index ?? 0) + s.length;
    r.push({ start: c, end: c + a[0].length - s.length });
  }
  const o = /`+[^`]+`+/g;
  for (const a of e.matchAll(o)) {
    const s = a.index ?? 0, c = s + a[0].length;
    r.some((p) => s >= p.start && c <= p.end) || r.push({ start: s, end: c });
  }
  return r.sort((a, s) => a.start - s.start), r;
}
function ym(e, r) {
  return r.some((i) => e >= i.start && e < i.end);
}
function xS(e) {
  const r = gm(e), i = [];
  let o = "answer", a = 0, s = 0;
  Fp.lastIndex = 0;
  for (const c of e.matchAll(Fp)) {
    const d = c.index ?? 0;
    if (ym(d, r)) continue;
    const p = c[1] === "/";
    if (o === "thought" && !p) continue;
    const h = d + c[0].length;
    i.push({ kind: o, start: a, contentStart: s, contentEnd: d, end: p ? h : d, unterminated: !1 }), o = p ? "answer" : "thought", a = p ? h : d, s = h;
  }
  return i.push({
    kind: o,
    start: a,
    contentStart: s,
    contentEnd: e.length,
    end: e.length,
    unterminated: o === "thought"
  }), i;
}
function Hu(e) {
  if (!e) return [];
  if (!vS.test(e)) return [{ kind: "answer", content: e }];
  const r = bS(e), i = wS(r, xS(r));
  return i.length === 0 ? [{ kind: "answer", content: e }] : RS(ES(i));
}
var kS = /<([a-z][\w-]*:tool_call)\b[^<>]*>\s*<\/\1>/gi;
function wS(e, r) {
  const i = [];
  for (const o of r) {
    const a = e.slice(o.contentStart, o.contentEnd), s = (o.kind === "thought" ? a.replace(kS, "") : a).trim();
    s && i.push({ kind: o.kind, content: s });
  }
  return i;
}
function bS(e) {
  if (Qi.lastIndex = 0, !Qi.test(e))
    return Qi.lastIndex = 0, e;
  Qi.lastIndex = 0;
  const r = gm(e), i = [];
  for (const a of e.matchAll(Qi)) {
    const s = a.index ?? 0;
    ym(s, r) || i.push({ start: s, length: a[0].length });
  }
  let o = e;
  for (let a = i.length - 1; a >= 0; a--) {
    const s = i[a];
    o = o.slice(0, s.start) + o.slice(s.start + s.length);
  }
  return o;
}
var vm = 40, SS = /^[A-Z0-9#*\-_>`[|("']/;
function CS(e) {
  return e.length > 0 && e.length <= vm && !SS.test(e);
}
function ES(e) {
  const r = e.filter((c) => c.kind === "answer");
  if (r.length === 0) return e;
  const i = r.map((c) => c.content).join(" ").trim();
  if (!CS(i)) return e;
  const o = e.filter((c) => c.kind === "thought"), a = o.reduce(
    (c, d) => !c || d.content.length > c.content.length ? d : c,
    null
  );
  if (!a || a.content.length <= i.length) return e;
  const s = [{ kind: "answer", content: `${a.content} ${i}`.trim() }];
  for (const c of o) c !== a && s.unshift(c);
  return s;
}
var _S = /[\p{L}\p{N},]$/u, TS = new RegExp("^\\p{Ll}", "u");
function jS(e) {
  let r = e.lastIndexOf(`
`) + 1;
  for (const i of e.matchAll(/[.!?](?=\s)/g)) {
    const o = (i.index ?? 0) + 1;
    o > r && (r = o);
  }
  return r;
}
function RS(e) {
  const r = [...e];
  for (let i = 1; i < r.length; i++) {
    const o = r[i - 1], a = r[i];
    if (o.kind !== "thought" || a.kind !== "answer" || a.content.length <= vm || !TS.test(a.content) || !_S.test(o.content)) continue;
    const s = jS(o.content), c = o.content.slice(0, s).trim();
    r[i] = { kind: "answer", content: `${o.content.slice(s).trim()} ${a.content}` }, c ? r[i - 1] = { kind: "thought", content: c } : (r.splice(i - 1, 1), i -= 1);
  }
  return r;
}
function xm(e) {
  return Hu(e).filter((r) => r.kind === "answer").map((r) => r.content).join(`

`).trim();
}
function LS(e) {
  return Hu(e).filter((r) => r.kind === "thought").map((r) => r.content).join(`

`).trim();
}
function Sl(e) {
  return `bf-msg-${e}`;
}
var NS = { copy: "Copy", copied: "Copied", apply: "Apply", createFile: "Create file", thought: "Thought" };
function AS(e) {
  const i = (e.split(`
`, 1)[0] ?? "").match(/(?:\/\/|#|<!--)\s*(?:path|file):\s*([^\s>]+)/i);
  return i ? i[1].trim() : "";
}
function zS(e) {
  return /^(https?:)?\/\//i.test(e) || e.startsWith("mailto:");
}
function PS({
  code: e,
  onApplyCode: r,
  onCreateFile: i,
  labels: o
}) {
  const [a, s] = $.useState(!1), c = () => {
    var d;
    (d = navigator.clipboard) == null || d.writeText(e).then(
      () => {
        s(!0), setTimeout(() => s(!1), 1500);
      },
      () => {
      }
    );
  };
  return /* @__PURE__ */ y.jsxs("div", { className: "bf-md__code", children: [
    /* @__PURE__ */ y.jsxs("div", { className: "bf-md__code-actions", children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", className: "bf-md__code-btn", onClick: c, children: a ? o.copied : o.copy }),
      r && /* @__PURE__ */ y.jsx("button", { type: "button", className: "bf-md__code-btn", onClick: () => r(e), children: o.apply }),
      i && /* @__PURE__ */ y.jsx("button", { type: "button", className: "bf-md__code-btn", onClick: () => i(AS(e), e), children: o.createFile })
    ] }),
    /* @__PURE__ */ y.jsx("pre", { children: /* @__PURE__ */ y.jsx("code", { children: e }) })
  ] });
}
function IS({ content: e, onInternalLink: r, onApplyCode: i, onCreateFile: o, labels: a }) {
  const s = $.useMemo(() => ({ ...NS, ...a }), [a]), c = $.useMemo(() => Hu(e), [e]), d = {
    a({ href: p, children: h, ...m }) {
      const v = p ?? "";
      return v && !zS(v) && r ? /* @__PURE__ */ y.jsx(
        "a",
        {
          href: v,
          onClick: (w) => {
            w.preventDefault(), r(v);
          },
          ...m,
          children: h
        }
      ) : /* @__PURE__ */ y.jsx("a", { href: v, target: "_blank", rel: "noopener noreferrer", ...m, children: h });
    },
    code(p) {
      const { className: h, children: m } = p, v = String(m ?? ""), w = v.replace(/\n$/, "");
      return h != null || v.endsWith(`
`) ? /* @__PURE__ */ y.jsx(PS, { code: w, onApplyCode: i, onCreateFile: o, labels: s }) : /* @__PURE__ */ y.jsx("code", { className: "bf-md__inline", children: m });
    },
    pre({ children: p }) {
      return /* @__PURE__ */ y.jsx(y.Fragment, { children: p });
    }
  };
  return /* @__PURE__ */ y.jsx("div", { className: "bf-md", children: c.map((p, h) => p.kind === "thought" ? /* @__PURE__ */ y.jsxs("details", { className: "bf-md__think", children: [
    /* @__PURE__ */ y.jsx("summary", { children: s.thought }),
    /* @__PURE__ */ y.jsx("div", { className: "bf-md__think-body", children: /* @__PURE__ */ y.jsx(Lp, { remarkPlugins: [Op], components: d, children: p.content }) })
  ] }, `${p.kind}-${h}`) : /* @__PURE__ */ y.jsx(Lp, { remarkPlugins: [Op], components: d, children: p.content }, `${p.kind}-${h}`)) });
}
var $p = xu.memo(IS);
function DS(e) {
  const r = e.trim().replace(/[()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  return r.length === 0 ? "?" : r.length === 1 ? r[0].slice(0, 2).toUpperCase() : (r[0][0] + r[1][0]).toUpperCase();
}
var Bp = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#0891b2", "#059669", "#4f46e5"];
function MS(e) {
  let r = 0;
  for (let i = 0; i < e.length; i++) r = r * 31 + e.charCodeAt(i) >>> 0;
  return Bp[r % Bp.length];
}
function du({ name: e, kind: r = "agent", size: i = 18, title: o, style: a }) {
  return /* @__PURE__ */ y.jsx(
    "span",
    {
      "aria-hidden": !0,
      title: o ?? e,
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: i,
        height: i,
        flex: `0 0 ${i}px`,
        borderRadius: r === "human" ? "50%" : Math.round(i * 0.3),
        background: MS(e),
        color: "#fff",
        fontSize: Math.max(8, Math.round(i * 0.44)),
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        userSelect: "none",
        ...a
      },
      children: DS(e)
    }
  );
}
function OS({ recipients: e, max: r = 3, size: i = 15 }) {
  if (e.length === 0) return null;
  const o = e.slice(0, r), a = e.length - o.length, s = Math.round(i * 0.3);
  return /* @__PURE__ */ y.jsxs("span", { title: e.map((c) => c.name).join(", "), style: { display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, opacity: 0.9 }, children: [
    /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, style: { opacity: 0.6 }, children: "→" }),
    /* @__PURE__ */ y.jsx("span", { style: { display: "inline-flex", alignItems: "center", flex: "0 0 auto" }, children: o.map((c, d) => /* @__PURE__ */ y.jsx(
      du,
      {
        name: c.name,
        kind: c.kind,
        size: i,
        style: d > 0 ? { marginLeft: -s, boxShadow: "0 0 0 1.5px var(--bf-surface, #1b1b1b)" } : void 0
      },
      `${c.kind}:${c.ref}`
    )) }),
    /* @__PURE__ */ y.jsxs("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
      o.map((c) => c.name).join(", "),
      a > 0 ? ` +${a}` : ""
    ] })
  ] });
}
var fu = {
  askSubmit: "Send",
  askAnswered: "Answered",
  askPending: "Answer needed",
  askJumpTo: "Show in conversation"
};
function FS({
  payload: e,
  labels: r,
  onAnswer: i,
  anchorId: o
}) {
  const a = $.useMemo(() => ({ ...fu, ...r }), [r]), [s, c] = $.useState(null), [d, p] = $.useState(() => /* @__PURE__ */ new Set()), h = e.multiSelect === !0, m = (x) => {
    s || !x.trim() || (c(x), i(x));
  }, v = (x) => {
    p((E) => {
      const L = new Set(E);
      return L.has(x) ? L.delete(x) : L.add(x), L;
    });
  }, w = () => {
    const x = e.options.filter((E, L) => d.has(L)).map((E) => E.label);
    x.length && m(x.join(", "));
  };
  return /* @__PURE__ */ y.jsxs("div", { id: o, className: `bf-qcard${s ? " bf-qcard--done" : ""}`, role: "group", "aria-label": e.question, children: [
    /* @__PURE__ */ y.jsx("div", { className: "bf-qcard__q", children: e.question }),
    /* @__PURE__ */ y.jsx("div", { className: "bf-qcard__opts", children: e.options.map(
      (x, E) => h ? /* @__PURE__ */ y.jsxs("label", { className: `bf-qcard__opt bf-qcard__opt--check${d.has(E) ? " is-checked" : ""}`, children: [
        /* @__PURE__ */ y.jsx(
          "input",
          {
            type: "checkbox",
            className: "bf-qcard__cb",
            checked: d.has(E),
            disabled: !!s,
            onChange: () => v(E)
          }
        ),
        /* @__PURE__ */ y.jsxs("span", { className: "bf-qcard__opt-body", children: [
          /* @__PURE__ */ y.jsx("span", { className: "bf-qcard__opt-label", children: x.label }),
          x.description && /* @__PURE__ */ y.jsx("span", { className: "bf-qcard__opt-desc", children: x.description })
        ] })
      ] }, E) : /* @__PURE__ */ y.jsxs(
        "button",
        {
          type: "button",
          className: "bf-qcard__opt bf-qcard__opt--btn",
          disabled: !!s,
          onClick: () => m(x.label),
          children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-qcard__opt-label", children: x.label }),
            x.description && /* @__PURE__ */ y.jsx("span", { className: "bf-qcard__opt-desc", children: x.description })
          ]
        },
        E
      )
    ) }),
    h && !s && /* @__PURE__ */ y.jsx("button", { type: "button", className: "bf-qcard__submit", disabled: d.size === 0, onClick: w, children: a.askSubmit }),
    s && /* @__PURE__ */ y.jsx("div", { className: "bf-qcard__answered", children: `${a.askAnswered}: ${s}` })
  ] });
}
var $S = ["not-attached", "not-seeded", "frozen"];
function BS(e) {
  return typeof e == "string" && $S.includes(e);
}
var Yt = {
  user: 0,
  recall: 1,
  memoryAnswer: 1,
  thinking: 2,
  assistant: 3,
  // An activity line reports what happened AFTER the turn that triggered it, so it sorts
  // with the tool steps rather than ahead of the narration.
  activity: 4,
  tool: 4,
  learn: 5,
  reconcile: 6,
  error: 7,
  streaming: 8
}, HS = Yt.tool;
function Gs(e, r) {
  if (!e) return r;
  const i = Date.parse(e);
  return Number.isFinite(i) ? i : r;
}
function qS(e) {
  if (!e.metadata) return [];
  try {
    const r = JSON.parse(e.metadata);
    return Array.isArray(r.attachments) ? r.attachments : [];
  } catch {
    return [];
  }
}
function US(e, r) {
  return r.size === 0 ? e : e.split(`
`).filter((i) => {
    const o = i.match(/^\[Attached:\s*(.+?)\]\((.*)\)\s*$/);
    return !(o && r.has(o[1].trim()));
  }).join(`
`).replace(/\n{3,}/g, `

`).trim();
}
function Hp(e, r, i) {
  switch (e.category) {
    case "tool":
      return { key: i, kind: "tool", ts: r, order: Yt.tool, label: e.label, args: e.args, result: e.result, isError: !!e.isError, durationMs: e.durationMs };
    case "error":
      return { key: i, kind: "error", ts: r, order: Yt.error, label: e.label, message: typeof e.result == "string" ? e.result : JSON.stringify(e.result ?? "") };
    case "recall": {
      const o = e.result ?? {};
      if (o.skippedLlm === !0 || e.label === "memory.answer" || e.label === "evermind.answer") {
        const a = o.source === "evermind" || e.label === "evermind.answer" ? "evermind" : "qa-cache";
        return { key: i, kind: "memoryAnswer", ts: r, order: Yt.memoryAnswer, source: a, version: typeof o.version == "number" && o.version > 0 ? o.version : null };
      }
      return { key: i, kind: "recall", ts: r, order: Yt.recall, version: typeof o.version == "number" ? o.version : 0, count: typeof o.count == "number" ? o.count : Array.isArray(o.items) ? o.items.length : 0, items: Array.isArray(o.items) ? o.items : [] };
    }
    case "learn": {
      const o = e.result ?? {}, a = o.skipped && BS(o.reason) ? o.reason : void 0, s = Array.isArray(o.targets) ? o.targets : void 0;
      return { key: i, kind: "learn", ts: r, order: Yt.learn, version: typeof o.version == "number" ? o.version : 0, ...a ? { skipped: a } : {}, ...s ? { targets: s } : {} };
    }
    case "reconcile": {
      const o = e.result ?? {};
      return { key: i, kind: "reconcile", ts: r, order: Yt.reconcile, version: typeof o.version == "number" ? o.version : 0, count: typeof o.count == "number" ? o.count : 0 };
    }
    default:
      return null;
  }
}
function WS(e, r) {
  const i = [], o = /* @__PURE__ */ new Set();
  for (const d of r)
    d.category !== "llm" && d.category !== "message" && o.add(Of(d.category, d.label, d.ts));
  e.forEach((d, p) => {
    const h = Gs(d.createdAt, p);
    if (d.role === "user") {
      const v = qS(d).filter((x) => x.imageUrl).map((x) => ({ url: x.imageUrl, name: x.name })), w = new Set(v.map((x) => x.name).filter((x) => !!x));
      i.push({
        key: `msg-${d.id}`,
        kind: "user",
        ts: h,
        order: Yt.user,
        message: d,
        text: US(d.content, w),
        images: v
      });
    } else if (My(d)) {
      const m = Hy(d.metadata);
      if (!m || o.has(Of(m.step.category, m.step.label, m.tsIso))) return;
      const v = Hp(m.step, Gs(m.tsIso, h), `msg-${d.id}`);
      v && i.push(v);
    } else {
      const m = Dv(d);
      if (m) {
        i.push({
          key: `msg-${d.id}`,
          kind: "activity",
          ts: h,
          order: Yt.activity,
          message: d,
          activity: m,
          // Pre-structured rows carry only the server's English sentence; showing it
          // beats showing nothing, so it rides along as the fallback.
          fallbackText: d.content
        });
        return;
      }
      i.push({
        key: `msg-${d.id}`,
        kind: "assistant",
        ts: h,
        order: Yt.assistant,
        message: d,
        text: d.content
      });
    }
  });
  const a = i.length;
  let s = 0;
  r.forEach((d, p) => {
    const h = Gs(d.ts, 1e15 + p);
    if (d.category === "llm")
      i.push({ key: `trace-${p}`, kind: "thinking", ts: h, order: Yt.thinking, durationMs: d.ttftMs ?? d.durationMs, step: s++ });
    else if (d.category !== "message") {
      const m = Hp(
        { category: d.category, label: d.label, args: d.args, result: d.result, isError: d.isError, durationMs: d.durationMs },
        h,
        `trace-${p}`
      );
      m && i.push(m);
    }
  });
  const c = (d, p) => p < a ? d.order : HS;
  return i.map((d, p) => ({ node: d, i: p, rank: c(d, p) })).sort((d, p) => d.node.ts - p.node.ts || d.rank - p.rank || d.i - p.i).map((d) => d.node);
}
function VS(e, r) {
  if (r) return null;
  for (let i = e.length - 1; i >= 0; i--) {
    const o = e[i];
    if (o.kind === "streaming" || o.kind === "user") return null;
    if (o.kind !== "assistant") continue;
    return o.text.trim() && !xm(o.text) ? o.key : null;
  }
  return null;
}
function GS(e, r) {
  return !r || !e.trim() ? null : { key: "streaming", kind: "streaming", ts: Number.MAX_SAFE_INTEGER, order: Yt.streaming, text: e };
}
function km(e) {
  if (e == null || !Number.isFinite(e)) return "0s";
  if (e < 1e3) return `${Math.max(0, Math.round(e / 1e3))}s`;
  if (e < 6e4) return `${Math.round(e / 1e3)}s`;
  const r = Math.floor(e / 6e4), i = Math.round(e % 6e4 / 1e3);
  return i ? `${r}m ${i}s` : `${r}m`;
}
function pu(e) {
  if (e == null) return "";
  if (typeof e == "string") return e;
  try {
    return JSON.stringify(e, null, 2);
  } catch {
    return String(e);
  }
}
var QS = 1500;
function to({ text: e, labels: r, icon: i = !1 }) {
  const [o, a] = $.useState(!1);
  return /* @__PURE__ */ y.jsx(
    "button",
    {
      type: "button",
      className: i ? "bf-tl__act" : "bf-tl__copy",
      title: o ? r.copied : r.copy,
      "aria-label": o ? r.copied : r.copy,
      "data-state": o ? "done" : void 0,
      onClick: (s) => {
        var c;
        s.stopPropagation(), (c = navigator.clipboard) == null || c.writeText(e).then(
          () => {
            a(!0), setTimeout(() => a(!1), QS);
          },
          () => {
          }
        );
      },
      children: i ? /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: o ? "✓" : "⧉" }) : o ? r.copied : r.copy
    }
  );
}
var wm = ["command", "cmd"], KS = /* @__PURE__ */ new Set([
  "ok",
  "stdout",
  "stderr",
  "output",
  "exitCode",
  "exit_code",
  "error",
  "truncated",
  "command",
  "durationMs",
  "signal",
  "timedOut"
]), YS = ["stdout", "output", "stderr", "error"];
function no(e) {
  return e && typeof e == "object" && !Array.isArray(e) ? e : null;
}
function qp(e) {
  return e.replace(/\s+$/, "");
}
function XS(e) {
  const r = no(e);
  if (!r) return null;
  for (const i of wm) {
    const o = r[i];
    if (typeof o == "string" && o.trim()) return o.trim();
  }
  return null;
}
function JS(e) {
  const r = no(e);
  if (r) return r;
  if (typeof e == "string") {
    const i = e.trim();
    if (i.startsWith("{"))
      try {
        return no(JSON.parse(i));
      } catch {
        return null;
      }
  }
  return null;
}
function Up(e, r) {
  const i = e[r];
  return typeof i == "number" && Number.isFinite(i) ? i : null;
}
function ZS(e) {
  if (e == null) return { output: "", exitCode: null, ok: !0, outputComplete: !0 };
  const r = JS(e);
  if (!r) {
    const c = typeof e == "string" ? e : pu(e);
    return { output: qp(c), exitCode: null, ok: !0, outputComplete: typeof e == "string" };
  }
  const i = [];
  for (const c of YS) {
    const d = r[c];
    typeof d == "string" && d.trim() && i.push(d);
  }
  const o = Up(r, "exitCode") ?? Up(r, "exit_code"), a = typeof r.ok == "boolean" ? r.ok : o == null ? !0 : o === 0, s = Object.keys(r).every((c) => KS.has(c));
  return { output: qp(i.join(`
`)), exitCode: o, ok: a, outputComplete: s };
}
function eC(e) {
  const r = no(e);
  if (!r) return null;
  const i = typeof r.path == "string" ? r.path : "";
  return typeof r.old_string == "string" && typeof r.new_string == "string" ? { kind: "edit", path: i, oldText: r.old_string, newText: r.new_string } : i && typeof r.content == "string" ? { kind: "write", path: i, content: r.content } : null;
}
function tC(e, r) {
  if (!r) return e;
  const i = no(e);
  if (!i) return e;
  const o = {};
  for (const [a, s] of Object.entries(i))
    wm.includes(a) || (o[a] = s);
  return Object.keys(o).length > 0 ? o : null;
}
function nC({ args: e, result: r, isError: i }) {
  const o = XS(e), a = o ? { command: o, ...ZS(r) } : null;
  return {
    subject: Gy(e) ?? null,
    command: a,
    preview: eC(e),
    argsText: pu(tC(e, o)),
    resultText: a != null && a.outputComplete ? "" : pu(r),
    // A command is the step a reader opens the transcript to check, and a failure is
    // the step they need to read at all — neither should cost a click to see.
    defaultOpen: !!a || i
  };
}
function hu({
  heading: e,
  text: r,
  labels: i,
  extra: o,
  className: a
}) {
  return /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io", children: [
    /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io-label", children: [
      /* @__PURE__ */ y.jsxs("span", { children: [
        e,
        o
      ] }),
      /* @__PURE__ */ y.jsx(to, { text: r, labels: i })
    ] }),
    /* @__PURE__ */ y.jsx("pre", { className: a ? `bf-tl__io-pre ${a}` : "bf-tl__io-pre", children: /* @__PURE__ */ y.jsx("code", { children: r }) })
  ] });
}
function Wp({ text: e, sign: r }) {
  const i = r === "+" ? "bf-tl__diff-add" : "bf-tl__diff-del";
  return /* @__PURE__ */ y.jsx(y.Fragment, { children: e.split(`
`).map((o, a) => /* @__PURE__ */ y.jsxs("div", { className: `bf-tl__diff-line ${i}`, children: [
    /* @__PURE__ */ y.jsx("span", { className: "bf-tl__diff-sign", "aria-hidden": !0, children: r }),
    /* @__PURE__ */ y.jsx("span", { className: "bf-tl__diff-text", children: o || " " })
  ] }, a)) });
}
function rC({ preview: e, labels: r }) {
  const i = e.kind === "edit" ? e.newText : e.content;
  return e.kind === "write" ? /* @__PURE__ */ y.jsx(hu, { heading: `${r.preview}${e.path ? ` · ${e.path}` : ""}`, text: i, labels: r }) : /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io", children: [
    /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io-label", children: [
      /* @__PURE__ */ y.jsxs("span", { children: [
        r.preview,
        e.path ? ` · ${e.path}` : ""
      ] }),
      /* @__PURE__ */ y.jsx(to, { text: i, labels: r })
    ] }),
    /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__diff", children: [
      /* @__PURE__ */ y.jsx(Wp, { text: e.oldText, sign: "-" }),
      /* @__PURE__ */ y.jsx(Wp, { text: e.newText, sign: "+" })
    ] })
  ] });
}
function iC({ run: e, labels: r }) {
  const i = e.exitCode != null && e.exitCode !== 0;
  return /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
    /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io", children: [
      /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io-label", children: [
        /* @__PURE__ */ y.jsx("span", { children: r.input }),
        /* @__PURE__ */ y.jsx(to, { text: e.command, labels: r })
      ] }),
      /* @__PURE__ */ y.jsx("pre", { className: "bf-tl__io-pre bf-tl__cmd-in", children: /* @__PURE__ */ y.jsxs("code", { children: [
        /* @__PURE__ */ y.jsx("span", { className: "bf-tl__cmd-prompt", "aria-hidden": !0, children: "$" }),
        e.command
      ] }) })
    ] }),
    /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io", children: [
      /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__io-label", children: [
        /* @__PURE__ */ y.jsxs("span", { children: [
          r.output,
          i && /* @__PURE__ */ y.jsx("em", { className: "bf-tl__cmd-exit", children: r.exitCode.replace("{code}", String(e.exitCode)) })
        ] }),
        e.output && /* @__PURE__ */ y.jsx(to, { text: e.output, labels: r })
      ] }),
      e.output ? /* @__PURE__ */ y.jsx("pre", { className: `bf-tl__io-pre bf-tl__cmd-out${e.ok ? "" : " bf-tl__cmd-out--error"}`, children: /* @__PURE__ */ y.jsx("code", { children: e.output }) }) : /* @__PURE__ */ y.jsx("p", { className: "bf-tl__cmd-empty", children: r.noOutput })
    ] })
  ] });
}
function oC({ node: e, labels: r }) {
  const i = nC(e), [o, a] = $.useState(i.defaultOpen);
  return /* @__PURE__ */ y.jsxs(
    "details",
    {
      className: `bf-tl__tool${e.isError ? " bf-tl__tool--error" : ""}`,
      open: o,
      onToggle: (s) => a(s.currentTarget.open),
      children: [
        /* @__PURE__ */ y.jsxs("summary", { className: "bf-tl__tool-head", children: [
          /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-status", "aria-hidden": !0, children: e.isError ? "✗" : "✓" }),
          /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-name", children: e.label }),
          i.subject && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-subject", children: i.subject }),
          e.durationMs != null && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-dur", children: km(e.durationMs) }),
          /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-caret", "aria-hidden": !0, children: "▸" })
        ] }),
        /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__tool-body", children: [
          i.command && /* @__PURE__ */ y.jsx(iC, { run: i.command, labels: r }),
          i.preview && /* @__PURE__ */ y.jsx(rC, { preview: i.preview, labels: r }),
          i.argsText && /* @__PURE__ */ y.jsx(hu, { heading: r.input, text: i.argsText, labels: r }),
          i.resultText && /* @__PURE__ */ y.jsx(hu, { heading: r.output, text: i.resultText, labels: r })
        ] })
      ]
    }
  );
}
var lC = 12e3, aC = 1e3, bm = {
  starting: "Starting…",
  thinking: "Thinking…",
  writing: "Writing the reply…",
  composing: "Composing a {tool} call…",
  composed: " — {bytes} so far",
  tool: "Running {tool}",
  awaiting: "Waiting for you to approve {tool}",
  finishing: "Wrapping up…",
  on: " on {target}",
  step: "step {step}",
  slow: "Still working — {elapsed} elapsed",
  ariaLabel: "Current activity"
};
function Vp(e) {
  const r = Math.max(0, Math.floor(e / 1e3));
  if (r < 60) return `${r}s`;
  const i = Math.floor(r / 60), o = r % 60;
  return `${i}m ${String(o).padStart(2, "0")}s`;
}
var sC = {
  starting: "◇",
  thinking: "◍",
  writing: "▍",
  composing: "✎",
  tool: "⟳",
  awaiting: "⏸",
  finishing: "◆"
};
function uC(e, r) {
  const i = e.label ?? "";
  if (e.phase === "composing") {
    const a = r.composing.replace("{tool}", i);
    return e.bytes != null ? `${a}${r.composed.replace("{bytes}", Qy(e.bytes))}` : a;
  }
  const o = e.phase === "starting" ? r.starting : e.phase === "thinking" ? r.thinking : e.phase === "writing" ? r.writing : e.phase === "finishing" ? r.finishing : e.phase === "awaiting" ? r.awaiting.replace("{tool}", i) : r.tool.replace("{tool}", i);
  return e.detail ? `${o}${r.on.replace("{target}", e.detail)}` : o;
}
function cC({ activity: e, isRunning: r, labels: i }) {
  const o = { ...bm, ...i }, [a, s] = $.useState(() => r ? Date.now() : null);
  $.useEffect(() => {
    s((x) => r ? x ?? Date.now() : null);
  }, [r]);
  const c = e ?? (r && a != null ? { phase: "starting", startedAt: a, step: 0 } : null), [d, p] = $.useState(() => Date.now()), h = c == null ? void 0 : c.startedAt;
  if ($.useEffect(() => {
    if (h == null) return;
    p(Date.now());
    const x = setInterval(() => p(Date.now()), aC);
    return () => clearInterval(x);
  }, [h]), !c) return null;
  const m = Math.max(0, d - c.startedAt), v = m >= lC, w = c.phase === "awaiting";
  return /* @__PURE__ */ y.jsxs(
    "li",
    {
      className: `bf-tl__item bf-tl__item--live bf-tl__item--live-${c.phase}`,
      "aria-live": "polite",
      "aria-label": o.ariaLabel,
      children: [
        /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: `bf-tl__dot ${w ? "bf-tl__dot--muted" : "bf-tl__dot--working"}`, "aria-hidden": !0, children: sC[c.phase] }) }),
        /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body", children: [
          /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__live-head", children: [
            /* @__PURE__ */ y.jsx("span", { className: `bf-tl__live-line${w ? "" : " bf-tl__live-line--shimmer"}`, children: uC(c, o) }),
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__live-elapsed", children: Vp(m) }),
            c.step > 0 && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__live-step", children: o.step.replace("{step}", String(c.step)) })
          ] }),
          !w && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__live-bar", "aria-hidden": !0, children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__live-bar-fill" }) }),
          v && !w && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__live-slow", children: o.slow.replace("{elapsed}", Vp(m)) })
        ] })
      ]
    }
  );
}
var dC = xu.memo(cC), fC = {
  thinking: "Thinking…",
  live: bm,
  thoughtFor: "Thought for {duration}",
  thought: "Thought",
  replyFromThought: "Recovered from the model's reasoning — the turn ended without a separate reply.",
  stoppedReply: "Stopped by you — this is what the model had written when you pressed Stop.",
  you: "You",
  assistant: "BuilderForce",
  input: "Input",
  output: "Output",
  error: "Error",
  loading: "Loading…",
  empty: "Ask BuilderForce to build or change something.",
  copy: "Copy",
  copied: "Copied",
  replay: "Send again",
  rateUp: "Good response",
  rateDown: "Bad response",
  apply: "Apply",
  createFile: "Create file",
  preview: "Preview",
  noOutput: "No output",
  exitCode: "Exit {code}",
  askSubmit: fu.askSubmit,
  askAnswered: fu.askAnswered,
  accountOwn: "Your account",
  accountShared: "Shared pool",
  accountByoUnused: "Your connected account wasn't used",
  ranOnEvermind: "Generated by this project's Evermind model",
  recallTitle: "Recalled {count} memories from Evermind v{version}",
  recallHint: "This project's self-learning Evermind recalled these prior learnings and grounded the answer on them.",
  memoryAnswerCache: "Answered from a saved reply — no model was called",
  memoryAnswerEvermind: "Answered by Evermind v{version} — no other model was called",
  memoryAnswerHint: "This project's memory already held an answer to this exact question, so it was replayed instead of running a model.",
  learnTitle: "Contributed this turn to Evermind v{version}",
  learnHint: "This turn was contributed back to the project Evermind — it will be merged into the learned model.",
  learnSkippedTitle: "Not learned this turn — {reason}",
  learnSkippedHint: "This turn wasn't contributed to the project Evermind. “Learning — Connected” reflects the selected project's model, not whether this chat feeds it.",
  learnSkipReason: {
    "not-attached": "this chat isn’t attached to a project",
    "not-seeded": "this project has no Evermind model yet",
    frozen: "this project’s Evermind is frozen (read-only)"
  },
  learnTargetContributed: "Contributed to {name} (project #{projectId} v{version})",
  learnTargetSkipped: "Skipped {name} (project #{projectId}) — {reason}",
  reconcileTitle: "Reconciled {count} learned memories in Evermind v{version}",
  reconcileHint: "The answer restated these recalled learnings, so it updates them (write-through cognition).",
  activity: Mv
};
function Gp({
  prov: e,
  labels: r,
  identity: i
}) {
  const o = e.account === "shared_byo_unused", a = e.account === "own" ? r.accountOwn : o ? r.accountByoUnused : e.account === "shared" ? r.accountShared : null, s = e.account === "own" ? "bf-tl__prov--own" : o ? "bf-tl__prov--unused" : "bf-tl__prov--shared", c = Gv(e.model, i, { account: e.account }), d = e.vendor && c === e.model ? `${c} · ${e.vendor}` : c;
  return /* @__PURE__ */ y.jsxs("div", { className: `bf-tl__prov ${s}`, children: [
    /* @__PURE__ */ y.jsx("span", { className: "bf-tl__prov-model", title: d, children: c }),
    a && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__prov-badge", children: a }),
    e.evermind ? /* @__PURE__ */ y.jsx("span", { className: "bf-tl__prov-evermind", title: r.ranOnEvermind, children: `🧠 Evermind v${e.evermind.version}` }) : null
  ] });
}
function Qt(e, r) {
  if (r) return "✗";
  switch (e) {
    case "user":
      return "›";
    case "assistant":
      return "✦";
    case "thinking":
      return "∴";
    case "tool":
      return "⚙";
    case "error":
      return "✗";
    case "recall":
    case "memoryAnswer":
    case "learn":
    case "reconcile":
      return "🧠";
    default:
      return "•";
  }
}
function Qp({
  message: e,
  role: r,
  text: i,
  labels: o,
  onReplay: a,
  onRate: s,
  rating: c
}) {
  if (!i.trim()) return null;
  const d = (p) => (h) => {
    h.stopPropagation(), s == null || s(e, c === p ? 0 : p);
  };
  return /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
    /* @__PURE__ */ y.jsx(to, { text: i, labels: o, icon: !0 }),
    a && /* @__PURE__ */ y.jsx(
      "button",
      {
        type: "button",
        className: "bf-tl__act",
        title: o.replay,
        "aria-label": o.replay,
        onClick: (p) => {
          p.stopPropagation(), a(e, r);
        },
        children: /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: "↻" })
      }
    ),
    s && r === "assistant" && /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
      /* @__PURE__ */ y.jsx(
        "button",
        {
          type: "button",
          className: "bf-tl__act",
          title: o.rateUp,
          "aria-label": o.rateUp,
          "aria-pressed": c === 1,
          "data-state": c === 1 ? "done" : void 0,
          onClick: d(1),
          children: /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: "👍" })
        }
      ),
      /* @__PURE__ */ y.jsx(
        "button",
        {
          type: "button",
          className: "bf-tl__act",
          title: o.rateDown,
          "aria-label": o.rateDown,
          "aria-pressed": c === -1,
          "data-state": c === -1 ? "done" : void 0,
          onClick: d(-1),
          children: /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: "👎" })
        }
      )
    ] })
  ] });
}
function pC({
  messages: e,
  trace: r,
  streamingText: i,
  isRunning: o,
  activity: a,
  loading: s,
  labels: c,
  modelIdentity: d = Su,
  assistantName: p,
  emptyState: h,
  renderMessage: m,
  renderStreaming: v,
  renderAssistantActions: w,
  onReplayMessage: x,
  onRateMessage: E,
  ratings: L,
  onInternalLink: D,
  onApplyCode: z,
  onCreateFile: U,
  onAnswerQuestion: B,
  autoScroll: ne = !0,
  revealMessage: Z = null
}) {
  const j = $.useMemo(() => ({ ...fC, ...c }), [c]), Y = p ?? j.assistant, se = $.useMemo(() => WS(e, r), [e, r]), re = $.useMemo(() => {
    const N = GS(i, o);
    return N ? [...se, N] : se;
  }, [se, i, o]), I = $.useMemo(() => VS(re, o), [re, o]), te = $.useRef(null), ie = $.useRef(null), xe = $.useRef(!0), oe = () => {
    const N = te.current;
    N && (xe.current = N.scrollHeight - N.scrollTop - N.clientHeight < 80);
  };
  $.useEffect(() => {
    if (!ne) return;
    const N = te.current, b = ie.current;
    if (!N || !b) return;
    const _ = () => {
      xe.current && (N.scrollTop = N.scrollHeight);
    };
    _();
    const O = new ResizeObserver(_);
    return O.observe(b), () => O.disconnect();
  }, [ne]), $.useEffect(() => {
    var S;
    if (Z == null) return;
    xe.current = !1;
    const N = typeof window < "u" && ((S = window.matchMedia) == null ? void 0 : S.call(window, "(prefers-reduced-motion: reduce)").matches), b = () => {
      const le = te.current;
      if (!le) return;
      const ye = document.getElementById(Sl(Z.id));
      if (!ye || !le.contains(ye)) return;
      const he = le.getBoundingClientRect(), Re = ye.getBoundingClientRect(), _e = Re.top - he.top - (he.height - Re.height) / 2;
      le.scrollTo({ top: le.scrollTop + _e, behavior: N ? "auto" : "smooth" });
    };
    b();
    const _ = requestAnimationFrame(b), O = window.setTimeout(b, 80);
    return () => {
      cancelAnimationFrame(_), window.clearTimeout(O);
    };
  }, [Z]);
  const X = (N, b, _) => m ? m(N, { role: b, text: _ }) : /* @__PURE__ */ y.jsx(
    $p,
    {
      content: _,
      onInternalLink: D,
      onApplyCode: b === "assistant" ? z : void 0,
      onCreateFile: b === "assistant" ? U : void 0,
      labels: j
    }
  ), ge = re.length === 0 && !s, Ce = (Z == null ? void 0 : Z.id) ?? null, q = (N) => Ce === N ? " bf-tl__item--focus" : "";
  return /* @__PURE__ */ y.jsxs("div", { className: "bf-tl-scroll", ref: te, onScroll: oe, children: [
    s && /* @__PURE__ */ y.jsx("div", { className: "bf-tl-status", children: j.loading }),
    ge && (h ?? /* @__PURE__ */ y.jsx("div", { className: "bf-tl-empty", children: j.empty })),
    /* @__PURE__ */ y.jsxs("ol", { className: "bf-tl", ref: ie, children: [
      re.map((N) => {
        if (N.kind === "user") {
          const b = qy(N.message), _ = Ff(N.message);
          return /* @__PURE__ */ y.jsxs("li", { id: Sl(N.message.id), className: `bf-tl__item bf-tl__item--user${q(N.message.id)}`, children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot", children: _ ? /* @__PURE__ */ y.jsx(du, { name: _.name, kind: _.kind, size: 16 }) : Qt("user") }) }),
            /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__role", style: b.length > 0 ? { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" } : void 0, children: [
                /* @__PURE__ */ y.jsx("span", { children: _ ? _.name : j.you }),
                /* @__PURE__ */ y.jsx(OS, { recipients: b })
              ] }),
              N.images.length > 0 && /* @__PURE__ */ y.jsx("div", { className: "bf-tl__images", children: N.images.map((O, S) => /* @__PURE__ */ y.jsx("img", { src: O.url, alt: O.name ?? "", className: "bf-tl__image" }, S)) }),
              N.text && /* @__PURE__ */ y.jsx("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: X(N.message, "user", N.text) }),
              /* @__PURE__ */ y.jsx("div", { className: "bf-tl__actions bf-tl__actions--hover", children: /* @__PURE__ */ y.jsx(Qp, { message: N.message, role: "user", text: N.text, labels: j, onReplay: x }) })
            ] })
          ] }, N.key);
        }
        if (N.kind === "assistant") {
          const b = Ff(N.message), _ = B ? zy(N.text) : null, O = _ ? Py(N.text) : N.text, S = Fy(N.message), le = xm(O), ye = N.key === I ? LS(O) : "", he = By(N.message);
          return !le && O && !_ && !ye && !he ? /* @__PURE__ */ y.jsxs("li", { id: Sl(N.message.id), className: `bf-tl__item bf-tl__item--thought${q(N.message.id)}`, children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("thinking") }) }),
            /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body bf-tl__thought-line", children: [
              X(N.message, "assistant", O),
              S && /* @__PURE__ */ y.jsx(Gp, { prov: S, labels: j, identity: d })
            ] })
          ] }, N.key) : /* @__PURE__ */ y.jsxs("li", { id: Sl(N.message.id), className: `bf-tl__item bf-tl__item--assistant${q(N.message.id)}`, children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot", children: b ? /* @__PURE__ */ y.jsx(du, { name: b.name, kind: b.kind, size: 16 }) : Qt("assistant") }) }),
            /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ y.jsx("div", { className: "bf-tl__role", children: b ? b.name : Y }),
              ye && /* @__PURE__ */ y.jsx("div", { className: "bf-tl__rescued", children: j.replyFromThought }),
              he && /* @__PURE__ */ y.jsx("div", { className: "bf-tl__rescued", children: j.stoppedReply }),
              O && /* @__PURE__ */ y.jsx("div", { className: "bf-tl__bubble", children: X(N.message, "assistant", ye || O) }),
              _ && B && /* @__PURE__ */ y.jsx(
                FS,
                {
                  payload: _,
                  labels: { askSubmit: j.askSubmit, askAnswered: j.askAnswered },
                  onAnswer: B,
                  anchorId: Iy(N.message.id)
                }
              ),
              /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__foot", children: [
                S && /* @__PURE__ */ y.jsx(Gp, { prov: S, labels: j, identity: d }),
                /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__actions bf-tl__actions--hover", children: [
                  /* @__PURE__ */ y.jsx(
                    Qp,
                    {
                      message: N.message,
                      role: "assistant",
                      text: le || ye,
                      labels: j,
                      onReplay: x,
                      onRate: E,
                      rating: L == null ? void 0 : L[N.message.id]
                    }
                  ),
                  w == null ? void 0 : w(N.message)
                ] })
              ] })
            ] })
          ] }, N.key);
        }
        if (N.kind === "thinking") {
          const b = j.thoughtFor.replace("{duration}", km(N.durationMs));
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("thinking") }) }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__thinking", children: b }) })
          ] }, N.key);
        }
        if (N.kind === "tool")
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: `bf-tl__dot${N.isError ? " bf-tl__dot--error" : ""}`, children: Qt("tool", N.isError) }) }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsx(oC, { node: N, labels: j }) })
          ] }, N.key);
        if (N.kind === "error")
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--error", children: Qt("error") }) }),
            /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ y.jsx("div", { className: "bf-tl__role bf-tl__role--error", children: j.error }),
              /* @__PURE__ */ y.jsx("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: N.message })
            ] })
          ] }, N.key);
        if (N.kind === "recall") {
          const b = j.recallTitle.replace("{count}", String(N.count)).replace("{version}", String(N.version));
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("recall") }) }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsxs("details", { className: "bf-tl__tool bf-tl__memory", children: [
              /* @__PURE__ */ y.jsxs("summary", { className: "bf-tl__tool-head", title: j.recallHint, children: [
                /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-name", children: b }),
                /* @__PURE__ */ y.jsx("span", { className: "bf-tl__tool-caret", "aria-hidden": !0, children: "▸" })
              ] }),
              /* @__PURE__ */ y.jsx("div", { className: "bf-tl__tool-body", children: /* @__PURE__ */ y.jsx("ol", { className: "bf-tl__memory-list", children: N.items.map((_) => /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__memory-item", children: [
                /* @__PURE__ */ y.jsxs("span", { className: "bf-tl__memory-score", "aria-hidden": !0, children: [
                  Math.round(_.score * 100),
                  "%"
                ] }),
                /* @__PURE__ */ y.jsx("span", { className: "bf-tl__memory-text", children: _.text })
              ] }, _.id)) }) })
            ] }) })
          ] }, N.key);
        }
        if (N.kind === "memoryAnswer") {
          const b = N.source === "evermind" && N.version != null ? j.memoryAnswerEvermind.replace("{version}", String(N.version)) : j.memoryAnswerCache;
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("memoryAnswer") }) }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__memory-line", title: j.memoryAnswerHint, children: b }) })
          ] }, N.key);
        }
        if (N.kind === "learn") {
          if (N.targets && N.targets.length > 0) {
            const O = N.targets.map((S) => {
              if (S.learned)
                return j.learnTargetContributed.replace("{name}", S.name).replace("{projectId}", String(S.projectId)).replace("{version}", String(S.version));
              const le = S.reason && S.reason !== "too-short" ? j.learnSkipReason[S.reason] : null;
              return le ? j.learnTargetSkipped.replace("{name}", S.name).replace("{projectId}", String(S.projectId)).replace("{reason}", le) : null;
            }).filter((S) => !!S);
            return O.length === 0 ? null : /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--memory", children: [
              /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("learn") }) }),
              /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__memory-line", children: O.join("; ") }) })
            ] }, N.key);
          }
          const b = N.skipped ? j.learnSkippedTitle.replace("{reason}", j.learnSkipReason[N.skipped]) : j.learnTitle.replace("{version}", String(N.version)), _ = N.skipped ? j.learnSkippedHint : j.learnHint;
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("learn") }) }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__memory-line", title: _, children: b }) })
          ] }, N.key);
        }
        if (N.kind === "activity") {
          const b = $v(N.activity, j.activity) || N.fallbackText, _ = Fv(N.activity);
          return /* @__PURE__ */ y.jsxs("li", { className: `bf-tl__item bf-tl__item--activity bf-tl__item--activity-${_}`, children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--activity", "aria-hidden": !0, children: Ov(N.activity) }) }),
            /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ y.jsx("span", { className: "bf-tl__activity-line", children: b }),
              N.activity.kind === "milestone" && N.activity.note && /* @__PURE__ */ y.jsx("span", { className: "bf-tl__activity-note", children: N.activity.note })
            ] })
          ] }, N.key);
        }
        if (N.kind === "reconcile") {
          const b = j.reconcileTitle.replace("{count}", String(N.count)).replace("{version}", String(N.version));
          return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--muted", children: Qt("reconcile") }) }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__body", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__memory-line", title: j.reconcileHint, children: b }) })
          ] }, N.key);
        }
        return /* @__PURE__ */ y.jsxs("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ y.jsx("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ y.jsx("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: Qt("assistant") }) }),
          /* @__PURE__ */ y.jsxs("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__role", children: Y }),
            /* @__PURE__ */ y.jsx("div", { className: "bf-tl__bubble", children: v ? v(N.text) : /* @__PURE__ */ y.jsx($p, { content: N.text, onInternalLink: D, labels: j }) })
          ] })
        ] }, N.key);
      }),
      o && !(i.trim() && (a == null ? void 0 : a.phase) === "writing") && /* @__PURE__ */ y.jsx(dC, { activity: a, isRunning: o, labels: j.live })
    ] })
  ] });
}
xu.memo(pC);
function hC(e, r = !1) {
  return r ? "var(--bf-health-muted, #9ca3af)" : e >= 100 ? "var(--bf-health-done, #16a34a)" : e >= 67 ? "var(--bf-health-good, #22c55e)" : e >= 34 ? "var(--bf-health-mid, #f59e0b)" : e > 0 ? "var(--bf-health-low, #f97316)" : "var(--bf-health-none, #ef4444)";
}
function Kp({ percent: e, size: r = 40, stroke: i = 4, caption: o, muted: a = !1, ariaLabel: s }) {
  const c = Math.max(0, Math.min(100, Math.round(e || 0))), d = (r - i) / 2, p = 2 * Math.PI * d, h = c / 100 * p, m = hC(c, a), v = s ?? `${c}% complete`;
  return /* @__PURE__ */ y.jsxs("span", { className: "bf-health-ring", style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }, children: [
    /* @__PURE__ */ y.jsxs("svg", { width: r, height: r, viewBox: `0 0 ${r} ${r}`, role: "img", "aria-label": v, children: [
      /* @__PURE__ */ y.jsx(
        "circle",
        {
          cx: r / 2,
          cy: r / 2,
          r: d,
          fill: "none",
          stroke: "var(--bf-health-track, rgba(148,163,184,0.25))",
          strokeWidth: i
        }
      ),
      /* @__PURE__ */ y.jsx(
        "circle",
        {
          cx: r / 2,
          cy: r / 2,
          r: d,
          fill: "none",
          stroke: m,
          strokeWidth: i,
          strokeLinecap: "round",
          strokeDasharray: `${h.toFixed(2)} ${(p - h).toFixed(2)}`,
          transform: `rotate(-90 ${r / 2} ${r / 2})`
        }
      ),
      /* @__PURE__ */ y.jsx(
        "text",
        {
          x: "50%",
          y: "50%",
          textAnchor: "middle",
          dominantBaseline: "central",
          fill: "var(--bf-health-text, currentColor)",
          style: { fontSize: Math.max(9, r * 0.28), fontWeight: 600 },
          children: c
        }
      )
    ] }),
    o ? /* @__PURE__ */ y.jsx("span", { style: { fontSize: 10, color: "var(--bf-health-caption, var(--bf-text-muted, #6b7280))", lineHeight: 1 }, children: o }) : null
  ] });
}
var Sm = {
  background: "var(--bf-ev-surface-solid, var(--bg-surface, var(--vscode-dropdown-background, Canvas)))",
  color: "var(--bf-ev-text, var(--text-primary, var(--vscode-dropdown-foreground, CanvasText)))"
};
function mC(e) {
  var i;
  const r = (i = e.canRunTicket) == null ? void 0 : i.call(e);
  return r ? { allowed: r.allowed, reason: r.reason } : { allowed: !0 };
}
function gC(e) {
  const r = (e ?? "").trim().toLowerCase();
  return r === "cancelled" || r === "canceled";
}
function yC(e) {
  let r = 0, i = 0, o = 0, a = 0;
  for (const s of e) {
    if (gC(s.status)) continue;
    const c = Number.isFinite(s.progressPct) ? s.progressPct : 0, d = Number.isFinite(s.total) && s.total > 0 ? s.total : 1;
    r += Number.isFinite(s.done) ? s.done : 0, i += d, o += c * d, a++;
  }
  return a === 0 ? { pct: e.length ? 100 : 0, done: 0, total: 0 } : { pct: Math.round(o / i), done: r, total: i };
}
function vC(e) {
  const r = e.title.trim() || `Chat ${e.id}`, i = e.runGlyph ?? "";
  if ((e.ticketCount ?? 0) <= 0 || e.ticketProgressPct == null || !Number.isFinite(e.ticketProgressPct))
    return `${i}${r}`;
  const a = Math.max(0, Math.min(100, Math.round(e.ticketProgressPct)));
  return `${i}${a}% · ${r}`;
}
var Me = {
  border: "var(--bf-ct-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  surface: "var(--bf-ct-surface, var(--bg-elevated, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))",
  surface2: "var(--bf-ct-surface-2, var(--bg-base, var(--bf-surface-2, var(--vscode-textBlockQuote-background, transparent))))",
  // Form controls specifically prefer the editor's dropdown/input tokens so the
  // native <select> and its option list match VS Code's own dropdowns.
  field: "var(--bf-ct-surface-2, var(--bg-base, var(--vscode-dropdown-background, var(--bf-surface, transparent))))",
  fieldText: "var(--bf-ct-text, var(--text-primary, var(--vscode-dropdown-foreground, var(--bf-text, inherit))))",
  text: "var(--bf-ct-text, var(--text-primary, var(--bf-text, inherit)))",
  text2: "var(--bf-ct-text-2, var(--text-secondary, var(--bf-text, inherit)))",
  muted: "var(--bf-ct-text-muted, var(--text-muted, var(--bf-text-muted, #6b7280)))",
  accent: "var(--bf-ct-accent, var(--accent, var(--bf-accent, #3b82f6)))"
};
function xC({ parent: e, inParent: r, onOpen: i, openTitle: o }) {
  if (!e) return null;
  const a = r(e.label);
  return /* @__PURE__ */ y.jsxs("span", { style: Cl.row, title: a, children: [
    /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, style: Cl.arrow, children: "↳" }),
    i ? /* @__PURE__ */ y.jsx("button", { type: "button", onClick: i, title: o ? `${o} · ${e.label}` : a, style: Cl.link, children: a }) : /* @__PURE__ */ y.jsx("span", { style: Cl.text, children: a })
  ] });
}
var Cl = {
  row: { display: "flex", alignItems: "baseline", gap: 3, minWidth: 0, maxWidth: "100%" },
  arrow: { fontSize: 9, color: Me.muted, flex: "0 0 auto" },
  // `minWidth: 0` on the flex ITEM is what actually lets it shrink and ellipsise —
  // without it a long epic title blows the chip's 160px text column wide open.
  text: { fontSize: 10, color: Me.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  link: {
    fontSize: 10,
    color: Me.muted,
    background: "transparent",
    border: "none",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "underline",
    textUnderlineOffset: 2
  }
}, kC = ["task", "epic", "gap", "objective", "initiative", "portfolio", "roadmap", "spec", "retro", "poker"], Cm = ["task", "epic", "gap"], wC = new Set(Cm), Yp = 8;
function bC({ chatId: e, projectId: r, chatList: i, adapter: o, labels: a, onChanged: s, refreshSignal: c, visibility: d, onSetVisibility: p, onOpenTicket: h, extensions: m }) {
  const [v, w] = $.useState([]), [x, E] = $.useState([]), [L, D] = $.useState([]), [z, U] = $.useState([]), [B, ne] = $.useState([]), [Z, j] = $.useState(null), Y = (W) => j((Ae) => Ae === W ? null : W), se = (m == null ? void 0 : m.find((W) => W.key === Z)) ?? null;
  $.useEffect(() => {
    Z && !CC(Z) && !(m != null && m.some((W) => W.key === Z)) && j(null);
  }, [Z, m]);
  const [re, I] = $.useState(null), [te, ie] = $.useState([]), [xe, oe] = $.useState(null), [X, ge] = $.useState(null), [Ce, q] = $.useState(!1), [N, b] = $.useState(null), _ = $.useRef(!1), O = $.useCallback(async () => {
    const [W, Ae, Ue, We] = await Promise.all([
      o.listTickets(e).catch(() => []),
      o.listAgents(e).catch(() => []),
      o.listMembers(e).catch(() => []),
      o.listQuestions(e).catch(() => [])
    ]);
    w(W), E(Ae), D(Ue), ne(We), _.current || b(W.length > Yp);
  }, [o, e]);
  $.useEffect(() => {
    O();
  }, [O, c]), $.useEffect(() => {
    o.loadAgentPool().then(U).catch(() => U([]));
  }, [o]);
  const S = (W) => {
    ge(W), typeof window < "u" && window.setTimeout(() => ge(null), 3500);
  }, le = $.useCallback((W) => {
    var Ae;
    return ((Ae = z.find((Ue) => Ue.ref === W)) == null ? void 0 : Ae.name) ?? W;
  }, [z]), ye = $.useCallback((W) => W.parent ? v.find((Ae) => Ae.kind === W.parent.kind && Ae.ref === W.parent.ref) : void 0, [v]), he = async (W) => {
    q(!0);
    try {
      await o.unlinkTicket(e, W.kind, W.ref), await O();
    } finally {
      q(!1);
    }
  }, Re = async (W) => {
    const Ae = `${W.kind}:${W.ref}`;
    if (re === Ae) {
      I(null);
      return;
    }
    I(Ae), ie(await o.listTicketChats(W.kind, W.ref).catch(() => []));
  }, _e = mC(o), Ne = async (W, Ae) => {
    q(!0);
    try {
      const Ue = await o.runTicket(W.kind, W.ref, Ae, e);
      S(Ue.started ? a.runStarted(Ue.agentName || le(Ae)) : a.runNoAgent), oe(null), await O();
    } catch (Ue) {
      S(Ue instanceof Error ? Ue.message : a.runFailed);
    } finally {
      q(!1);
    }
  }, Be = $.useMemo(() => yC(v), [v]), He = v.length > 0 && (N ?? v.length > Yp), Sn = () => {
    _.current = !0, b(!He);
  };
  return /* @__PURE__ */ y.jsxs("div", { style: ue.root, children: [
    v.length > 0 && /* @__PURE__ */ y.jsxs(
      "button",
      {
        type: "button",
        onClick: Sn,
        "aria-expanded": !He,
        title: He ? a.showTickets : a.hideTickets,
        style: ue.ticketsHeader,
        children: [
          /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, style: { ...ue.caret, transform: He ? "rotate(0deg)" : "rotate(90deg)" }, children: "▸" }),
          /* @__PURE__ */ y.jsx(Kp, { percent: Be.pct, size: 22, muted: !1, ariaLabel: a.overallAria(Be.pct) }),
          /* @__PURE__ */ y.jsx("span", { style: ue.ticketsCount, children: a.ticketCount(v.length) }),
          /* @__PURE__ */ y.jsxs("span", { style: ue.ticketsAgg, children: [
            Be.pct,
            "%",
            Be.total > 0 ? ` · ${Be.done}/${Be.total}` : ""
          ] })
        ]
      }
    ),
    !He && /* @__PURE__ */ y.jsx("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: v.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: a.none }) : v.map((W) => {
      const Ae = `${W.kind}:${W.ref}`, Ue = ye(W);
      return /* @__PURE__ */ y.jsxs("div", { style: ue.chip, children: [
        /* @__PURE__ */ y.jsx(Kp, { percent: W.progressPct, size: 36, caption: W.total > 0 ? `${W.done}/${W.total}` : void 0, muted: !W.exists, ariaLabel: a.ringAria(W.label, W.progressPct) }),
        /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: 160 }, children: [
          h && W.exists ? /* @__PURE__ */ y.jsx("button", { type: "button", title: `${a.open} · ${W.label}`, onClick: () => h(W), style: ue.ticketLink, children: W.label }) : /* @__PURE__ */ y.jsx("span", { style: ue.ticketLabel, title: W.label, children: W.label }),
          /* @__PURE__ */ y.jsxs("span", { style: ue.ticketMeta, children: [
            a.kind[W.kind],
            " · ",
            W.status,
            W.linkType === "created" ? ` · ${a.spawned}` : ""
          ] }),
          /* @__PURE__ */ y.jsx(
            xC,
            {
              parent: W.parent,
              inParent: a.inParent,
              openTitle: a.open,
              onOpen: h && Ue ? () => h(Ue) : void 0
            }
          )
        ] }),
        /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 2 }, children: [
          h && W.exists && /* @__PURE__ */ y.jsx("button", { type: "button", title: `${a.open} · ${W.label}`, onClick: () => h(W), style: ue.icon, children: "↗" }),
          wC.has(W.kind) && W.exists && /* @__PURE__ */ y.jsx(
            "button",
            {
              type: "button",
              disabled: !_e.allowed,
              "aria-disabled": !_e.allowed,
              title: _e.allowed ? a.run : _e.reason ?? a.run,
              onClick: () => oe(xe === Ae ? null : Ae),
              style: _e.allowed ? ue.icon : { ...ue.icon, opacity: 0.45, cursor: "not-allowed" },
              children: "▶"
            }
          ),
          /* @__PURE__ */ y.jsx("button", { type: "button", title: a.lineage, onClick: () => void Re(W), style: ue.icon, children: "⑃" }),
          /* @__PURE__ */ y.jsx("button", { type: "button", title: a.unlink, disabled: Ce, onClick: () => void he(W), style: ue.icon, children: "✕" })
        ] }),
        xe === Ae && /* @__PURE__ */ y.jsxs("select", { "aria-label": a.pickAgent, value: "", onChange: (We) => {
          We.target.value && Ne(W, We.target.value);
        }, style: ue.select, children: [
          /* @__PURE__ */ y.jsx("option", { style: ue.option, value: "", children: a.pickAgent }),
          x.map((We) => /* @__PURE__ */ y.jsxs("option", { style: ue.option, value: We.agentRef, children: [
            "★ ",
            le(We.agentRef)
          ] }, We.id)),
          z.filter((We) => !x.some((Jt) => Jt.agentRef === We.ref)).map((We) => /* @__PURE__ */ y.jsx("option", { style: ue.option, value: We.ref, children: We.name }, We.ref))
        ] })
      ] }, W.linkId);
    }) }),
    re && /* @__PURE__ */ y.jsxs("div", { style: ue.drawer, children: [
      /* @__PURE__ */ y.jsx("strong", { style: { color: Me.text }, children: a.lineageTitle }),
      te.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: { marginLeft: 8, ...ue.muted }, children: a.lineageEmpty }) : /* @__PURE__ */ y.jsx("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: te.map((W) => /* @__PURE__ */ y.jsxs("li", { style: { marginBottom: 2 }, children: [
        /* @__PURE__ */ y.jsx("span", { style: { fontWeight: W.chatId === e ? 700 : 400 }, children: W.title }),
        W.linkType === "created" ? /* @__PURE__ */ y.jsx("em", { style: { color: Me.accent, marginLeft: 6 }, children: a.spawned }) : null,
        W.isArchived ? /* @__PURE__ */ y.jsxs("span", { style: { marginLeft: 6, ...ue.muted }, children: [
          "(",
          a.merged,
          ")"
        ] }) : null
      ] }, W.chatId)) })
    ] }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsxs("button", { type: "button", onClick: () => Y("link"), style: ue.pill(Z === "link"), children: [
        "＋ ",
        a.link
      ] }),
      /* @__PURE__ */ y.jsxs("button", { type: "button", onClick: () => Y("agents"), style: ue.pill(Z === "agents"), children: [
        "👥 ",
        a.agents,
        x.length ? ` (${x.length})` : ""
      ] }),
      /* @__PURE__ */ y.jsxs("button", { type: "button", onClick: () => Y("people"), style: ue.pill(Z === "people"), children: [
        "👤 ",
        a.people,
        L.length ? ` (${L.length})` : ""
      ] }),
      /* @__PURE__ */ y.jsxs("button", { type: "button", onClick: () => Y("merge"), style: ue.pill(Z === "merge"), children: [
        "⧉ ",
        a.merge
      ] }),
      B.length > 0 && /* @__PURE__ */ y.jsxs("button", { type: "button", onClick: () => Y("questions"), style: ue.pill(Z === "questions"), children: [
        "❓ ",
        a.questions,
        " (",
        B.length,
        ")"
      ] }),
      m == null ? void 0 : m.map((W) => /* @__PURE__ */ y.jsxs(
        "button",
        {
          type: "button",
          title: W.title ?? W.label,
          "aria-label": W.title ?? W.label,
          "aria-expanded": Z === W.key,
          onClick: () => Y(W.key),
          style: ue.pill(Z === W.key),
          children: [
            W.icon ? `${W.icon} ` : "",
            W.label,
            W.count ? ` (${W.count})` : ""
          ]
        },
        W.key
      )),
      X && /* @__PURE__ */ y.jsx("span", { style: { fontSize: 12, color: Me.accent, alignSelf: "center" }, children: X })
    ] }),
    se && /* @__PURE__ */ y.jsx("div", { style: ue.drawer, children: se.render() }),
    Z === "link" && /* @__PURE__ */ y.jsx(TC, { search: o.searchTickets, projectId: r, existing: v, labels: a, onLink: async (W, Ae, Ue) => {
      try {
        await o.linkTicket(e, { kind: W, ref: Ae, linkType: Ue }), await O();
      } catch (We) {
        S(We instanceof Error ? We.message : a.linkFailed);
      }
    } }),
    Z === "agents" && /* @__PURE__ */ y.jsx(
      jC,
      {
        agents: x,
        pool: z,
        labels: a,
        onInvite: async (W, Ae) => {
          q(!0);
          try {
            await o.inviteAgent(e, { agentRef: W, agentKind: Ae }), await O(), s == null || s();
          } finally {
            q(!1);
          }
        },
        onRemove: async (W) => {
          q(!0);
          try {
            await o.removeAgent(e, W), await O(), s == null || s();
          } finally {
            q(!1);
          }
        },
        busy: Ce
      }
    ),
    Z === "people" && /* @__PURE__ */ y.jsx(
      RC,
      {
        members: L,
        labels: a,
        visibility: d,
        onSetVisibility: p,
        onInvite: async (W) => {
          q(!0);
          try {
            const Ae = await o.inviteMember(e, W);
            S(Ae.status === "pending" ? a.invitePending : a.inviteSent), await O(), s == null || s();
          } catch (Ae) {
            S(Ae instanceof Error ? Ae.message : a.linkFailed);
          } finally {
            q(!1);
          }
        },
        onRemove: async (W) => {
          q(!0);
          try {
            await o.removeMember(e, W), await O(), s == null || s();
          } finally {
            q(!1);
          }
        },
        busy: Ce
      }
    ),
    Z === "merge" && /* @__PURE__ */ y.jsx(
      LC,
      {
        chatId: e,
        chatList: i,
        labels: a,
        onMerge: async (W) => {
          q(!0);
          try {
            await o.consolidate(e, W), S(a.mergedN(W.length)), await O(), s == null || s();
          } finally {
            q(!1);
          }
        },
        busy: Ce
      }
    ),
    Z === "questions" && /* @__PURE__ */ y.jsx(
      EC,
      {
        questions: B,
        labels: a,
        onAnswer: async (W, Ae) => {
          await o.answerQuestion(W, Ae), await O(), s == null || s();
        }
      }
    )
  ] });
}
var SC = /* @__PURE__ */ new Set(["link", "agents", "people", "merge", "questions"]);
function CC(e) {
  return SC.has(e);
}
function EC({ questions: e, labels: r, onAnswer: i }) {
  const [o, a] = $.useState({}), [s, c] = $.useState(null);
  return /* @__PURE__ */ y.jsx("div", { style: ue.drawer, children: e.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: r.noQuestions }) : e.map((d, p) => {
    const h = o[d.id] ?? "";
    return /* @__PURE__ */ y.jsxs("div", { style: { padding: "10px 0", borderBottom: p < e.length - 1 ? `1px solid ${Me.border}` : void 0 }, children: [
      /* @__PURE__ */ y.jsx("div", { style: { color: Me.text, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", marginBottom: 8 }, children: d.description }),
      /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "flex-start" }, children: [
        /* @__PURE__ */ y.jsx(
          "textarea",
          {
            value: h,
            onChange: (m) => a((v) => ({ ...v, [d.id]: m.target.value })),
            placeholder: r.answerPlaceholder,
            rows: 2,
            disabled: s === d.id,
            style: { ...ue.select, flex: 1, resize: "vertical", minHeight: 54, fontFamily: "inherit" }
          }
        ),
        /* @__PURE__ */ y.jsx("button", { type: "button", disabled: !h.trim() || s === d.id, style: ue.pill(!0), onClick: () => {
          c(d.id), i(d.id, h.trim()).finally(() => c(null));
        }, children: s === d.id ? r.answering : r.submitAnswer })
      ] })
    ] }, d.id);
  }) });
}
var _C = 40;
function TC({ search: e, projectId: r, existing: i, labels: o, onLink: a }) {
  const [s, c] = $.useState("task"), [d, p] = $.useState(""), [h, m] = $.useState(""), [v, w] = $.useState("linked"), [x, E] = $.useState(!1), [L, D] = $.useState([]), [z, U] = $.useState(!1);
  $.useEffect(() => {
    let j = !0;
    U(!0);
    const Y = setTimeout(() => {
      e(s, h, r).then((se) => {
        j && D(se);
      }).catch(() => {
        j && D([]);
      }).finally(() => {
        j && U(!1);
      });
    }, 250);
    return () => {
      j = !1, clearTimeout(Y);
    };
  }, [e, s, h, r]);
  const B = $.useMemo(
    () => L.filter((j) => !i.some((Y) => Y.kind === s && Y.ref === j.ref)),
    [L, i, s]
  ), ne = L.length >= _C;
  $.useEffect(() => {
    d && !B.some((j) => j.ref === d) && p("");
  }, [B, d]);
  const Z = async () => {
    if (d) {
      E(!0);
      try {
        await a(s, d, v), p(""), m("");
      } finally {
        E(!1);
      }
    }
  };
  return /* @__PURE__ */ y.jsxs("div", { style: ue.section, children: [
    /* @__PURE__ */ y.jsx("select", { "aria-label": o.kindLabel, value: s, onChange: (j) => {
      c(j.target.value), p(""), m("");
    }, style: ue.select, children: kC.map((j) => /* @__PURE__ */ y.jsx("option", { style: ue.option, value: j, children: o.kind[j] }, j)) }),
    /* @__PURE__ */ y.jsx(
      "input",
      {
        type: "search",
        "aria-label": o.searchTicket,
        placeholder: o.searchTicket,
        value: h,
        onChange: (j) => m(j.target.value),
        style: { ...ue.select, minWidth: 150 }
      }
    ),
    /* @__PURE__ */ y.jsxs("select", { "aria-label": o.pickTicket, value: d, onChange: (j) => p(j.target.value), style: { ...ue.select, minWidth: 200 }, children: [
      /* @__PURE__ */ y.jsx("option", { style: ue.option, value: "", children: o.pickTicket }),
      B.map((j) => /* @__PURE__ */ y.jsx("option", { style: ue.option, value: j.ref, children: j.label }, j.ref))
    ] }),
    z ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: o.searching }) : B.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: o.noMatches }) : ne ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: o.refine }) : null,
    /* @__PURE__ */ y.jsxs("select", { "aria-label": o.linkTypeLabel, value: v, onChange: (j) => w(j.target.value), style: ue.select, children: [
      /* @__PURE__ */ y.jsx("option", { style: ue.option, value: "linked", children: o.linkTypeLinked }),
      /* @__PURE__ */ y.jsx("option", { style: ue.option, value: "created", children: o.linkTypeCreated })
    ] }),
    /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void Z(), disabled: x || !d, style: ue.pill(!0), children: x ? "…" : o.linkAction })
  ] });
}
function jC({ agents: e, pool: r, labels: i, onInvite: o, onRemove: a, busy: s }) {
  const c = (p) => {
    var h;
    return ((h = r.find((m) => m.ref === p)) == null ? void 0 : h.name) ?? p;
  }, d = r.filter((p) => !e.some((h) => h.agentRef === p.ref));
  return /* @__PURE__ */ y.jsxs("div", { style: { ...ue.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ y.jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: e.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: i.noAgents }) : e.map((p) => /* @__PURE__ */ y.jsxs("span", { style: ue.agentChip, children: [
      /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: "🤖" }),
      c(p.agentRef),
      /* @__PURE__ */ y.jsx("button", { type: "button", title: i.removeAgent, disabled: s, onClick: () => void a(p.id), style: { ...ue.icon, fontSize: 11 }, children: "✕" })
    ] }, p.id)) }),
    /* @__PURE__ */ y.jsxs("select", { "aria-label": i.inviteAgent, value: "", onChange: (p) => {
      const h = r.find((m) => m.ref === p.target.value);
      h && o(h.ref, h.kind);
    }, style: { ...ue.select, maxWidth: 260 }, children: [
      /* @__PURE__ */ y.jsx("option", { style: ue.option, value: "", children: i.inviteAgent }),
      d.map((p) => /* @__PURE__ */ y.jsxs("option", { style: ue.option, value: p.ref, children: [
        p.name,
        " — ",
        p.meta
      ] }, p.ref))
    ] }),
    /* @__PURE__ */ y.jsx("span", { style: { fontSize: 11, ...ue.muted }, children: i.agentsHint })
  ] });
}
function RC({ members: e, labels: r, visibility: i, onSetVisibility: o, onInvite: a, onRemove: s, busy: c }) {
  const [d, p] = $.useState(""), h = async () => {
    const v = d.trim();
    v && (await a(v), p(""));
  }, m = i === "locked";
  return /* @__PURE__ */ y.jsxs("div", { style: { ...ue.section, flexDirection: "column", alignItems: "stretch" }, children: [
    i && o && /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", disabled: c, onClick: () => void o(m ? "shared" : "locked"), style: ue.pill(m), children: m ? `🔒 ${r.visibilityLocked}` : `🔓 ${r.visibilityShared}` }),
      /* @__PURE__ */ y.jsx("span", { style: { fontSize: 11, ...ue.muted }, children: r.lockHint })
    ] }),
    /* @__PURE__ */ y.jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: e.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: r.noPeople }) : e.map((v) => /* @__PURE__ */ y.jsxs("span", { style: ue.agentChip, children: [
      /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: v.status === "pending" ? "✉️" : "👤" }),
      v.name,
      /* @__PURE__ */ y.jsx("button", { type: "button", title: r.removePerson, disabled: c, onClick: () => void s(v.id), style: { ...ue.icon, fontSize: 11 }, children: "✕" })
    ] }, v.id)) }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 6 }, children: [
      /* @__PURE__ */ y.jsx(
        "input",
        {
          type: "email",
          value: d,
          disabled: c,
          onChange: (v) => p(v.target.value),
          onKeyDown: (v) => {
            v.key === "Enter" && h();
          },
          placeholder: r.invitePerson,
          "aria-label": r.invitePerson,
          style: { ...ue.select, flex: 1, maxWidth: 260 }
        }
      ),
      /* @__PURE__ */ y.jsx("button", { type: "button", disabled: c || !d.trim(), onClick: () => void h(), style: ue.pill(!1), children: "＋" })
    ] }),
    /* @__PURE__ */ y.jsx("span", { style: { fontSize: 11, ...ue.muted }, children: r.invitePersonHint })
  ] });
}
function LC({ chatId: e, chatList: r, labels: i, onMerge: o, busy: a }) {
  const [s, c] = $.useState([]), d = r.filter((h) => h.id !== e), p = (h) => c((m) => m.includes(h) ? m.filter((v) => v !== h) : [...m, h]);
  return /* @__PURE__ */ y.jsxs("div", { style: { ...ue.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ y.jsx("span", { style: { fontSize: 12, color: Me.text2 }, children: i.mergeHint }),
    /* @__PURE__ */ y.jsx("div", { style: { maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }, children: d.length === 0 ? /* @__PURE__ */ y.jsx("span", { style: ue.muted, children: i.mergeNoOthers }) : d.map((h) => /* @__PURE__ */ y.jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 4px", cursor: "pointer" }, children: [
      /* @__PURE__ */ y.jsx("input", { type: "checkbox", checked: s.includes(h.id), onChange: () => p(h.id) }),
      /* @__PURE__ */ y.jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: vC({ title: h.title, id: h.id, ticketCount: h.ticketCount, ticketProgressPct: h.ticketProgressPct }) })
    ] }, h.id)) }),
    /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => {
      s.length && o(s).then(() => c([]));
    }, disabled: a || s.length === 0, style: ue.pill(!0), children: a ? "…" : i.mergeAction(s.length) })
  ] });
}
$.memo(bC);
var ue = {
  root: { margin: "4px 0 0", padding: "8px 10px", border: `1px solid ${Me.border}`, borderRadius: 10, background: Me.surface, display: "flex", flexDirection: "column", gap: 8 },
  muted: { fontSize: 12, color: Me.muted },
  // Collapsible ticket-summary header — full-width, button-reset, subtle hover-less
  // affordance that carries a caret, an overall health ring and the linked count.
  ticketsHeader: { display: "flex", alignItems: "center", gap: 8, padding: "2px 4px", width: "100%", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: Me.text },
  caret: { display: "inline-block", fontSize: 11, color: Me.muted, transition: "transform 120ms ease" },
  ticketsCount: { fontSize: 12, fontWeight: 600, color: Me.text },
  ticketsAgg: { fontSize: 11, color: Me.muted },
  chip: { display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", border: `1px solid ${Me.border}`, borderRadius: 8 },
  ticketLabel: { fontSize: 12, fontWeight: 600, color: Me.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  // Clickable variant of the label — opens the artifact. Underlined-on-hover link
  // affordance, theme-driven accent, left-aligned and truncating like the span.
  ticketLink: { fontSize: 12, fontWeight: 600, color: Me.accent, background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline", textUnderlineOffset: 2 },
  ticketMeta: { fontSize: 10, color: Me.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  drawer: { fontSize: 12, color: Me.text2, borderTop: `1px dashed ${Me.border}`, paddingTop: 6 },
  section: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: `1px dashed ${Me.border}`, paddingTop: 8 },
  agentChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 999, background: Me.surface2, border: `1px solid ${Me.border}`, fontSize: 12, color: Me.text },
  // `colorScheme` makes the browser draw the native <select> (and its OS/UA popup)
  // in the editor's active scheme even where the token background doesn't reach.
  select: { minWidth: 120, padding: "4px 8px", fontSize: 12, borderRadius: 8, border: `1px solid ${Me.border}`, background: Me.field, color: Me.fieldText, colorScheme: "inherit" },
  // The option popup is drawn by the OS and does NOT inherit `select`'s background,
  // so each option needs its own opaque pair — see nativeOptionStyle.
  option: Sm,
  icon: { fontSize: 12, lineHeight: 1, padding: "2px 4px", cursor: "pointer", background: "transparent", border: "none", color: Me.muted },
  pill: (e) => ({
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 999,
    cursor: "pointer",
    border: `1px solid ${e ? Me.accent : Me.border}`,
    background: e ? Me.accent : Me.surface2,
    color: e ? "#fff" : Me.text2
  })
};
new Set(Cm);
function NC(e) {
  const r = e - Date.now(), i = Math.abs(r), o = new Intl.RelativeTimeFormat("en", { numeric: "auto" }), a = 6e4, s = 60 * a, c = 24 * s;
  return i < a ? o.format(Math.round(r / 1e3), "second") : i < s ? o.format(Math.round(r / a), "minute") : i < c ? o.format(Math.round(r / s), "hour") : o.format(Math.round(r / c), "day");
}
var Em = {
  title: "Project Evermind",
  description: "The self-learning model for this project. It adapts as this project’s agents run — inspect what it has learned and steer its training below.",
  loading: "Loading…",
  managerOnlyHint: "Only a project manager can change these settings.",
  inheritedHint: "This build shares its parent project’s Evermind, so everything it has learned is available here. Training and settings live on the parent project.",
  statusSeeded: (e) => `Learning · v${e}`,
  statusUnseeded: "Not set up",
  quarantinedBadge: "Quarantined",
  quarantinedHint: (e) => `This Evermind auto-disabled after producing incoherent output (${e}). Retrain it past the coherence bar to re-enable inference.`,
  codingGateQualified: (e, r) => `Coding eval ${e}% of baseline — qualified to serve IDE coding turns (needs ${r}%).`,
  codingGateBelowBar: (e, r) => `Coding eval ${e}% of baseline, needs ${r}% — IDE coding turns stay on the frontier model.`,
  codingGateNoEval: (e) => `No coding eval recorded for this version — needs ${e}% of the frontier baseline before it can serve IDE coding turns.`,
  codingGateStale: (e, r, i) => `Coding eval was recorded for v${e}; the head is now v${r}. Re-run it — needs ${i}% of the frontier baseline to serve IDE coding turns.`,
  targetsTitle: "Everminds under this project",
  targetsHint: "Every Evermind this project contributes learning to.",
  targetsEmpty: "No Everminds resolved for this project yet.",
  targetSelfBadge: "This project",
  targetBuildBadge: "IDE build",
  targetSeeded: (e) => `v${e}`,
  targetUnseeded: "not seeded",
  targetInferenceOn: "inference",
  targetConnected: "connected",
  targetFrozen: "frozen",
  targetProjectId: (e) => `project #${e}`,
  evalDelta: (e) => `${e}% vs prev`,
  evalFlat: "no change",
  evalTooltip: (e, r, i, o) => `Regression check on v${e}: held-out loss ${r} → ${i} across ${o} prior task(s).`,
  pickModelLabel: "Base model",
  noModels: "No published Evermind models to start from yet. Train and publish one in Studio first.",
  notSetUp: "This project’s Evermind hasn’t been set up yet. A project manager can enable it.",
  enableCta: "Enable",
  working: "Working…",
  versionLabel: "Version",
  contributionsLabel: "Learned",
  pendingLabel: "Queued",
  lastLearnedLabel: "Last learned",
  neverLearned: "Never",
  formatWhen: NC,
  inferenceLabel: "Run on Evermind",
  inferenceHint: "When on, this project’s agent runs execute on its own learned model.",
  learningLabel: "Learning",
  learningHint: "When connected, runs contribute what they learn back into the model.",
  on: "On",
  off: "Off",
  connected: "Connected",
  frozen: "Frozen",
  teacherLabel: "Teacher model",
  teacherHint: "Distil learning through a frontier model (task → its ideal answer) instead of raw run text. Pick one to enable — then every agent run learns from its answer, and you can teach it a task directly below.",
  teacherNone: "None (learn from raw runs)",
  teacherPaidOnly: "A teacher model is available on paid plans.",
  teacherActiveHint: (e) => `Teaching from ${e}. Every agent run — and each task you teach below — is answered by ${e}, and your Evermind learns from its ideal answer. There is nothing else to switch on.`,
  teachTitle: "Teach from a transcript",
  teachHint: "Paste a chat transcript or exemplar to contribute it to the model now.",
  teachPromptPlaceholder: "Task this answered (optional)…",
  teachTextPlaceholder: "Paste the transcript or exemplar text…",
  teachCta: "Teach",
  teaching: "Teaching…",
  taught: "Queued for learning.",
  taughtDistilled: (e, r) => `Taught: ${e} answered it and the model learned that answer (v${r}).`,
  taughtSelf: (e) => `Taught: learned from your text, with no teacher model (v${e}).`,
  taughtTeacherFault: (e, r) => `Learned, but the teacher ${e} produced nothing (${r}) — so the model learned your raw text, not an ideal answer.`,
  taughtDropped: "Not learned: the merge could not use this contribution.",
  taughtStillPending: "Still queued — this will merge on the next learning pass.",
  teachTeacherTitle: "Teach a task",
  teachTeacherHint: (e) => `Describe a task and ${e} answers it — your Evermind learns from the ideal answer. No transcript needed.`,
  teachTaskPlaceholder: "Describe a task to teach — the teacher will answer it…",
  teachTeacherCta: "Teach from teacher",
  flushCta: "Learn now",
  flushing: "Learning…",
  flushedNone: "Nothing queued to learn yet.",
  flushedN: (e, r) => `Merged ${e} contribution(s) into v${r}.`,
  importTitle: "Import from builderforce-memory",
  importHint: "Fold a local memory snapshot into this model, then compact the absorbed facts to stubs so they stop filling your context.",
  importCta: "Import & compact…",
  importing: "Importing…",
  importDone: (e, r, i, o) => `Absorbed ${e} memor${e === 1 ? "y" : "ies"} into v${r}; compacted ${i} to stubs (~${o} KB recovered).`,
  importNothing: "Nothing to import — no learnable facts in that file.",
  validateCta: "Validate",
  validating: "Checking…",
  validateHint: "Check which learned memories would answer this task — before you teach it.",
  validateResultTitle: (e) => `Memories that would answer “${e}”`,
  validateEmpty: "No learned memory matches this task yet — teaching it would add new knowledge.",
  validatePrimaryBadge: "Most likely used",
  validateScore: (e) => `${e}% match`,
  validateClear: "Clear",
  validateMethod: (e) => e === "embedding" ? "Semantic recall" : "Lexical recall (fallback)",
  inspectTitle: "Recently learned",
  inspectEmpty: "Nothing learned yet. Runs and teaching will appear here.",
  kindText: "Run",
  kindDelta: "Delta",
  deltaEntry: "Weight delta contributed by an agent run.",
  versionTag: (e) => `v${e}`,
  weightTag: (e) => `×${e}`,
  viewDetail: "View detail",
  hideDetail: "Hide detail",
  detailPromptLabel: "Task",
  detailTextLabel: "Learned",
  notDistilled: "Not distilled",
  distilledBy: (e) => `via ${e}`,
  teacherFault: (e, r) => `The teacher${e ? ` (${e})` : ""} produced no answer (${r}), so nothing was learned for this task. Check the pinned teacher model and your frontier credit, then teach it again.`,
  testTitle: "Test bench",
  testHint: "Run a prompt through the model and see exactly what it writes, graded the same way a real reply is. This is how you check the model is worth switching on — before anyone chats with it.",
  testPlaceholder: "Ask the model something, e.g. “Summarise where this project stands.”",
  testRunCta: "Run prompt",
  testReadinessCta: "Readiness check",
  testRunning: "Generating…",
  testResultReadiness: (e, r) => `Readiness check — ${e} of ${r} answers usable`,
  testResultPrompt: "What the model produced",
  testServable: "Usable",
  testRefused: "Refused",
  testRefusedBecause: (e) => `This would not be shown to a user: ${e}.`,
  testEmptyOutput: "(the model produced nothing)",
  testVerdictReady: "This model is coherent enough to serve replies.",
  testVerdictNotReady: "This model is not coherent enough to serve replies yet. Teach it more, set a teacher model, or re-seed it below.",
  maintenanceTitle: "Maintenance",
  maintenanceHint: "Repair and tidy the model when it has gone wrong. None of this deletes your project’s work.",
  reseedLabel: "Replace the model",
  reseedHint: "Start over from a known-good base, keeping the project. Use this when the model has trained itself into nonsense. Replies stay switched off until it passes a readiness check again.",
  reseedCta: "Replace…",
  reseedConfirm: "Replace this model’s brain with a fresh base? What it has learned so far will no longer shape its answers. This cannot be undone.",
  reseedStarterOption: "Fresh starter base (untrained)",
  reseedDone: (e) => `Model replaced — now at v${e}. Run a readiness check before switching replies back on.`,
  reindexLabel: "Rebuild recall index",
  reindexHint: "Re-file every memory against the current model. Memories are filed when they are learned, so recall drifts as the model changes — rebuild if it starts recalling the wrong things.",
  reindexCta: "Rebuild index",
  reindexDone: (e) => `Re-filed ${e} memor${e === 1 ? "y" : "ies"}.`,
  cleanupLabel: "Clean up",
  cleanupHint: "Throw away anything queued but not yet learned, and clear cached answers so repeat questions are answered fresh. Learned knowledge is untouched.",
  cleanupCta: "Clean up",
  cleanupConfirm: "Discard everything queued but not yet learned, and clear cached answers?",
  cleanupDone: (e, r) => `Discarded ${e} queued item(s) and cleared ${r} cached answer(s).`,
  analyzeTitle: "Check what it has learned",
  analyzeHint: "Read back everything the model has learned and have a frontier model check it for mistakes, stale facts and nonsense — then fix what is wrong by teaching the corrections.",
  analyzeCta: "Check knowledge",
  analyzing: "Checking…",
  analyzeClean: (e) => `Checked ${e} memor${e === 1 ? "y" : "ies"} — nothing looks wrong.`,
  analyzeSummary: (e, r, i) => `${e} of ${r} memories need attention (checked by ${i}).`,
  analyzeSummaryLocal: (e, r) => `${e} of ${r} memories need attention.`,
  analyzeVerdict: (e) => ({
    ok: "Fine",
    incoherent: "Nonsense",
    incorrect: "Wrong",
    outdated: "Out of date",
    unusable: "Not an answer",
    redundant: "Duplicate"
  })[e] ?? e,
  analyzeCorrectionLabel: "Will be replaced with",
  analyzeSelectAll: "Select all",
  analyzeSelectNone: "Clear selection",
  analyzeApplyCta: (e) => `Fix ${e} selected`,
  analyzeApplying: "Fixing…",
  analyzeApplied: (e, r, i) => `${e} corrected and re-taught, ${r} removed from recall (already-learned influence is superseded by the correction, not erased). Model is now at v${i}.`,
  analyzeCoverage: (e, r) => `Reviewed the ${e} most recent of ${r} memories — run again to continue through the rest.`,
  analyzeSkipped: (e, r) => `${e} could not be applied: ${r}`,
  tabsLabel: "Evermind controls",
  tabTeach: "Teach",
  tabTest: "Test",
  tabCheck: "Check",
  tabMaintain: "Maintain",
  diagnosticsTitle: "Diagnostics",
  diagnosticsHint: "Copy a full triage pack: model state, path-to-serve checklist, coding gate, learn-quality mix (distilled vs raw-run), readiness samples with verbatim output, and recent memories. Run readiness first when you can — the report says when it was skipped.",
  diagnosticsCta: "Copy full diagnostics",
  diagnosticsCopied: "Copied to your clipboard.",
  diagnosticsShow: "Show report",
  diagnosticsHide: "Hide report",
  diagnosticsManualHint: "Copying automatically was blocked here — the report is selected below, press Ctrl/Cmd+C to copy it.",
  refresh: "Refresh",
  errorGeneric: "Something went wrong. Try again."
};
function uo(e) {
  var o, a;
  if (e.kind === "delta") return { state: "delta" };
  if (e.distilled)
    return { state: "distilled", ...e.teacherModel ? { teacherModel: e.teacherModel } : {} };
  if (e.skipReason)
    return e.skipReason === "not_pinned" || e.skipReason === "legacy" ? { state: "self" } : {
      state: "fault",
      reason: e.skipReason,
      ...e.attemptedTeacherModel ? { teacherModel: e.attemptedTeacherModel } : {},
      ...e.skipDetail ? { detail: e.skipDetail } : {}
    };
  const r = (o = e.prompt) == null ? void 0 : o.trim(), i = (a = e.text) == null ? void 0 : a.trim();
  return r && i && r === i ? { state: "fault", reason: "unknown" } : { state: "self" };
}
function _m(e) {
  var o, a;
  if (!e.seeded) return { id: "seed", tone: "attention", title: "Set up the model", detail: "Choose a known-good base before teaching or serving replies.", destination: "Setup", cta: "Choose base model" };
  if (e.quarantinedAt)
    return (o = e.probe) != null && o.ready ? { id: "enable", tone: "good", title: "Readiness passed — enable replies", detail: "The current version passed the coherence gate and can be promoted back to serving.", destination: "Run on Evermind", cta: "Enable replies" } : e.probe && !e.probe.ready && !e.teacherModel ? { id: "teacher", tone: "danger", title: "Readiness failed — add a teacher", detail: "Pin a frontier teacher so future tasks become clean exemplars instead of raw run transcripts, then teach and test again.", destination: "Teach → Teacher model", cta: "Choose teacher" } : e.probe && !e.probe.ready ? { id: "check", tone: "danger", title: "Readiness failed — check learned knowledge", detail: "Audit recent learnings, repair bad memories, then rerun the readiness check.", destination: "Check", cta: "Check knowledge" } : { id: "test", tone: "danger", title: "Quarantined — run readiness first", detail: "Replies are safely off. Test the current version before changing inference or replacing the model.", destination: "Test → Readiness check", cta: "Run readiness check" };
  const i = (e.recent ?? []).filter((s) => uo(s).state === "fault").length;
  return i > 0 ? { id: "teacher", tone: "danger", title: "Fix failed distillation", detail: `${i} recent learning${i === 1 ? "" : "s"} received no usable teacher answer. Check the pinned teacher before teaching again.`, destination: "Teach → Teacher model", cta: "Check teacher" } : (e.pending ?? 0) > 0 ? { id: "merge", tone: "attention", title: "Merge queued learning", detail: `${e.pending} contribution${e.pending === 1 ? " is" : "s are"} waiting to be folded into the next version.`, destination: "Teach → Learn now", cta: "Learn now" } : (((a = e.eval) == null ? void 0 : a.delta) ?? 0) < 0 ? { id: "check", tone: "attention", title: "Review the latest regression", detail: "Held-out loss increased on the latest version. Audit what changed before serving it.", destination: "Check", cta: "Check knowledge" } : e.inferenceEnabled ? e.mode === "offline-frozen" ? { id: "learn", tone: "neutral", title: "Learning is frozen", detail: "Replies are live, but completed work is not updating this model.", destination: "Learning", cta: "Connect learning" } : { id: "none", tone: "good", title: "No action required", detail: "Learning is connected and replies are enabled. Review recent learnings as new work lands.", destination: "Recently learned", cta: "Review learnings" } : { id: "test", tone: "attention", title: "Test before enabling replies", detail: "Run the readiness suite against the current version, then enable inference only if it passes.", destination: "Test → Readiness check", cta: "Run readiness check" };
}
var F = {
  surface: "var(--bf-ev-surface, var(--bg-surface, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))",
  surface2: "var(--bf-ev-surface-2, var(--bg-elevated, var(--bf-surface-2, var(--vscode-textBlockQuote-background, rgba(148,163,184,0.08)))))",
  border: "var(--bf-ev-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  text: "var(--bf-ev-text, var(--text-primary, var(--bf-text, inherit)))",
  text2: "var(--bf-ev-text-2, var(--text-secondary, var(--bf-text-muted, #6b7280)))",
  accent: "var(--bf-ev-accent, var(--coral-bright, var(--accent, var(--bf-accent, #ff6b5e))))",
  danger: "var(--bf-ev-danger, var(--danger-text, #d9534f))",
  ok: "var(--bf-ev-ok, var(--success-text, #16a34a))",
  warnText: "var(--bf-warn-text, #92400e)",
  warnBg: "var(--bf-warn-bg, #fef3c7)",
  warnBorder: "var(--bf-warn-border, #f59e0b)"
}, In = { margin: 0, fontSize: "0.78rem", color: F.text2, fontStyle: "italic" }, AC = { fontSize: "0.78rem", fontWeight: 600, color: F.text2 }, Xt = { fontSize: "0.82rem", fontWeight: 600, color: F.text }, bn = { fontSize: "0.72rem", color: F.text2, lineHeight: 1.4 }, ir = {
  padding: "7px 9px",
  fontSize: "0.8rem",
  borderRadius: 8,
  border: `1px solid ${F.border}`,
  background: F.surface2,
  color: F.text,
  boxSizing: "border-box"
}, ro = Sm, sr = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  borderTop: `1px solid ${F.border}`,
  paddingTop: 10
}, Nl = {
  fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.74rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: F.surface,
  border: `1px solid ${F.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  color: F.text,
  maxHeight: 220,
  overflow: "auto"
};
function ri(e) {
  return {
    padding: "8px 14px",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: 8,
    border: "1px solid transparent",
    background: e ? F.surface2 : F.accent,
    color: e ? F.text2 : "#fff",
    cursor: e ? "not-allowed" : "pointer",
    whiteSpace: "nowrap"
  };
}
function Dn(e) {
  return {
    padding: "8px 14px",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${F.border}`,
    background: "transparent",
    color: e ? F.text2 : F.text,
    cursor: e ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    opacity: e ? 0.7 : 1
  };
}
function Tm(e) {
  return {
    padding: "8px 14px",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${e ? F.border : F.danger}`,
    background: "transparent",
    color: e ? F.text2 : F.danger,
    cursor: e ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    opacity: e ? 0.7 : 1
  };
}
var mu = {
  marginLeft: "auto",
  padding: "2px 8px",
  fontSize: "0.9rem",
  lineHeight: 1,
  borderRadius: 6,
  border: `1px solid ${F.border}`,
  background: "transparent",
  color: F.text2,
  cursor: "pointer"
}, qu = {
  padding: 0,
  fontSize: "0.7rem",
  fontWeight: 600,
  border: "none",
  background: "transparent",
  color: F.accent,
  cursor: "pointer"
};
function zC(e) {
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 10px",
    borderRadius: 999,
    border: `1px solid ${F.border}`,
    background: F.surface2,
    color: e ? F.accent : F.text2
  };
}
function Uu(e) {
  return {
    fontSize: "0.64rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "1px 6px",
    borderRadius: 5,
    border: `1px solid ${F.border}`,
    color: e ? F.text2 : F.accent,
    background: F.surface
  };
}
function Al(e) {
  const r = e === "ok" ? F.ok : e === "warn" ? F.warnText : F.danger;
  return {
    fontSize: "0.62rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "1px 6px",
    borderRadius: 5,
    whiteSpace: "nowrap",
    color: r,
    border: `1px solid ${r}`,
    ...e === "warn" ? { background: F.warnBg } : {}
  };
}
var $l = {
  margin: 0,
  fontSize: "0.74rem",
  lineHeight: 1.5,
  borderRadius: 6,
  padding: "6px 8px",
  color: F.warnText,
  background: F.warnBg,
  border: `1px solid ${F.warnBorder}`
};
function PC({ t: e, disabled: r, onProbe: i, result: o, onResult: a }) {
  const [s, c] = $.useState(""), [d, p] = $.useState(!1), [h, m] = $.useState(null), v = $.useCallback(async (L) => {
    p(!0), m(null);
    try {
      a(await i(L ? s.trim() : void 0));
    } catch (D) {
      a(null), m(D instanceof Error ? D.message : e.errorGeneric);
    } finally {
      p(!1);
    }
  }, [i, a, s, e.errorGeneric]), w = r || d, x = s.trim().length >= 3, E = (o == null ? void 0 : o.samples.filter((L) => L.coherent).length) ?? 0;
  return /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.testTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: e.testHint }),
    /* @__PURE__ */ y.jsx(
      "textarea",
      {
        value: s,
        onChange: (L) => c(L.target.value),
        disabled: w,
        placeholder: e.testPlaceholder,
        rows: 2,
        style: { ...ir, width: "100%", resize: "vertical", fontFamily: "inherit" }
      }
    ),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void v(!0), disabled: w || !x, style: ri(w || !x), children: d ? e.testRunning : e.testRunCta }),
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void v(!1), disabled: w, style: Dn(w), children: e.testReadinessCta })
    ] }),
    h && /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.76rem", color: F.danger }, role: "alert", children: h }),
    o && /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }, children: [
      /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ y.jsx("span", { style: { ...Xt, flex: "1 1 auto", minWidth: 0 }, children: o.mode === "readiness" ? e.testResultReadiness(E, o.samples.length) : e.testResultPrompt }),
        /* @__PURE__ */ y.jsx("span", { style: Al(o.ready ? "ok" : "bad"), children: o.ready ? e.testServable : e.testRefused })
      ] }),
      /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.74rem", lineHeight: 1.5, color: o.ready ? F.text2 : F.danger }, children: o.ready ? e.testVerdictReady : e.testVerdictNotReady }),
      o.samples.map((L, D) => /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
        o.samples.length > 1 && /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ y.jsx("span", { style: Al(L.coherent ? "ok" : "bad"), children: L.coherent ? e.testServable : e.testRefused }),
          /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.72rem", fontWeight: 600, color: F.text, wordBreak: "break-word", minWidth: 0 }, children: L.prompt })
        ] }),
        /* @__PURE__ */ y.jsx("div", { style: Nl, children: L.text.trim() || e.testEmptyOutput }),
        !L.coherent && L.detail && /* @__PURE__ */ y.jsx("p", { style: { ...In, color: F.danger, fontStyle: "normal", fontSize: "0.72rem" }, children: e.testRefusedBecause(L.detail) })
      ] }, `${L.prompt}-${D}`))
    ] })
  ] });
}
function IC({
  t: e,
  disabled: r,
  seedModels: i,
  onReseed: o,
  onReindex: a,
  onCleanup: s
}) {
  const [c, d] = $.useState(""), [p, h] = $.useState(null), m = $.useCallback(async () => {
    h(null), await (o == null ? void 0 : o(c || void 0));
  }, [o, c]), v = $.useCallback(async () => {
    h(null), await (s == null ? void 0 : s());
  }, [s]);
  return !o && !a && !s ? null : /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.maintenanceTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: e.maintenanceHint }),
    a && /* @__PURE__ */ y.jsx(
      Qs,
      {
        title: e.reindexLabel,
        hint: e.reindexHint,
        action: /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void a(), disabled: r, style: Dn(r), children: e.reindexCta })
      }
    ),
    s && /* @__PURE__ */ y.jsx(
      Qs,
      {
        title: e.cleanupLabel,
        hint: e.cleanupHint,
        action: /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => h("cleanup"), disabled: r || p === "cleanup", style: Dn(r || p === "cleanup"), children: e.cleanupCta }),
        confirm: p === "cleanup" ? /* @__PURE__ */ y.jsx(
          Xp,
          {
            message: e.cleanupConfirm,
            confirmLabel: e.cleanupCta,
            cancelLabel: e.validateClear,
            disabled: r,
            onConfirm: () => void v(),
            onCancel: () => h(null)
          }
        ) : null
      }
    ),
    o && /* @__PURE__ */ y.jsx(
      Qs,
      {
        title: e.reseedLabel,
        hint: e.reseedHint,
        action: /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }, children: [
          /* @__PURE__ */ y.jsxs(
            "select",
            {
              value: c,
              onChange: (w) => d(w.target.value),
              disabled: r,
              "aria-label": e.reseedLabel,
              style: { ...ir, maxWidth: 200 },
              children: [
                /* @__PURE__ */ y.jsx("option", { value: "", style: ro, children: e.reseedStarterOption }),
                i.map((w) => /* @__PURE__ */ y.jsx("option", { value: w.slug, style: ro, children: w.name }, w.slug))
              ]
            }
          ),
          /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => h("reseed"), disabled: r || p === "reseed", style: Tm(r || p === "reseed"), children: e.reseedCta })
        ] }),
        confirm: p === "reseed" ? /* @__PURE__ */ y.jsx(
          Xp,
          {
            message: e.reseedConfirm,
            confirmLabel: e.reseedCta,
            cancelLabel: e.validateClear,
            danger: !0,
            disabled: r,
            onConfirm: () => void m(),
            onCancel: () => h(null)
          }
        ) : null
      }
    )
  ] });
}
function Qs({ title: e, hint: r, action: i, confirm: o }) {
  return /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsxs("div", { style: { flex: "1 1 200px", minWidth: 0 }, children: [
        /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.8rem", fontWeight: 600, color: F.text }, children: e }),
        /* @__PURE__ */ y.jsx("div", { style: bn, children: r })
      ] }),
      /* @__PURE__ */ y.jsx("div", { style: { flex: "0 1 auto" }, children: i })
    ] }),
    o
  ] });
}
function Xp({
  message: e,
  confirmLabel: r,
  cancelLabel: i,
  danger: o,
  disabled: a,
  onConfirm: s,
  onCancel: c
}) {
  return /* @__PURE__ */ y.jsxs("div", { style: { ...$l, display: "flex", flexDirection: "column", gap: 8 }, role: "alertdialog", "aria-label": e, children: [
    /* @__PURE__ */ y.jsx("span", { children: e }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: s, disabled: a, style: o ? Tm(a) : Dn(a), children: r }),
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: c, disabled: a, style: Dn(a), children: i })
    ] })
  ] });
}
var DC = {
  ok: "ok",
  incoherent: "bad",
  incorrect: "bad",
  outdated: "warn",
  unusable: "bad",
  redundant: "warn"
};
function MC({ t: e, disabled: r, onAnalyze: i, onApply: o, onRepaired: a, analysis: s, onAnalysis: c }) {
  const [d, p] = $.useState(/* @__PURE__ */ new Set()), [h, m] = $.useState(!1), [v, w] = $.useState(!1), [x, E] = $.useState(null), [L, D] = $.useState(null);
  $.useEffect(() => {
    p(new Set((s == null ? void 0 : s.findings.map((Y) => Y.id)) ?? []));
  }, [s]);
  const z = $.useCallback(async () => {
    m(!0), D(null), E(null);
    try {
      c(await i());
    } catch (Y) {
      c(null), D(Y instanceof Error ? Y.message : e.errorGeneric);
    } finally {
      m(!1);
    }
  }, [i, c, e.errorGeneric]), U = $.useCallback(async () => {
    if (!o || !s) return;
    const Y = s.findings.filter((se) => d.has(se.id));
    if (Y.length !== 0) {
      w(!0), D(null);
      try {
        const se = await o(Y);
        E(se);
        const re = new Set(se.skipped.map((te) => te.id)), I = s.findings.filter((te) => re.has(te.id) || !d.has(te.id));
        c(I.length > 0 ? { ...s, findings: I } : null), se.corrected + se.forgotten > 0 && (a == null || a());
      } catch (se) {
        D(se instanceof Error ? se.message : e.errorGeneric);
      } finally {
        w(!1);
      }
    }
  }, [s, c, o, a, d, e.errorGeneric]), B = $.useCallback((Y) => {
    p((se) => {
      const re = new Set(se);
      return re.has(Y) ? re.delete(Y) : re.add(Y), re;
    });
  }, []), ne = (s == null ? void 0 : s.findings) ?? [], Z = $.useMemo(() => ne.length > 0 && ne.every((Y) => d.has(Y.id)), [ne, d]), j = r || h || v;
  return /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.analyzeTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: e.analyzeHint }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void z(), disabled: j, style: Dn(j), children: h ? e.analyzing : e.analyzeCta }),
      ne.length > 0 && o && /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
        /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void U(), disabled: j || d.size === 0, style: ri(j || d.size === 0), children: v ? e.analyzeApplying : e.analyzeApplyCta(d.size) }),
        /* @__PURE__ */ y.jsx(
          "button",
          {
            type: "button",
            onClick: () => p(Z ? /* @__PURE__ */ new Set() : new Set(ne.map((Y) => Y.id))),
            disabled: j,
            style: qu,
            children: Z ? e.analyzeSelectNone : e.analyzeSelectAll
          }
        )
      ] })
    ] }),
    L && /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.76rem", color: F.danger }, role: "alert", children: L }),
    x && /* @__PURE__ */ y.jsx(OC, { t: e, repair: x }),
    (s == null ? void 0 : s.warning) && /* @__PURE__ */ y.jsx("p", { style: $l, role: "note", children: s.warning }),
    s && ne.length === 0 && /* @__PURE__ */ y.jsx("p", { style: In, children: e.analyzeClean(s.analyzed) }),
    (s == null ? void 0 : s.truncated) && typeof s.total == "number" && /* @__PURE__ */ y.jsx("p", { style: In, children: e.analyzeCoverage(s.analyzed, s.total) }),
    s && ne.length > 0 && /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
      /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.74rem", color: F.text2 }, children: s.model ? e.analyzeSummary(ne.length, s.analyzed, s.model) : e.analyzeSummaryLocal(ne.length, s.analyzed) }),
      /* @__PURE__ */ y.jsx("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: ne.map((Y) => /* @__PURE__ */ y.jsx(
        FC,
        {
          t: e,
          finding: Y,
          selectable: !!o,
          selected: d.has(Y.id),
          disabled: j,
          onToggle: () => B(Y.id)
        },
        Y.id
      )) })
    ] })
  ] });
}
function OC({ t: e, repair: r }) {
  const i = r.corrected + r.forgotten > 0, o = [...new Set(r.skipped.map((a) => a.reason))].join("; ");
  return !i && !o ? null : /* @__PURE__ */ y.jsxs(
    "p",
    {
      style: i ? { margin: 0, fontSize: "0.76rem", color: F.accent } : $l,
      role: "status",
      children: [
        i ? e.analyzeApplied(r.corrected, r.forgotten, r.version) : "",
        i && o ? " " : "",
        o ? e.analyzeSkipped(r.skipped.length, o) : ""
      ]
    }
  );
}
function FC({
  t: e,
  finding: r,
  selected: i,
  selectable: o,
  disabled: a,
  onToggle: s
}) {
  const c = DC[r.verdict] ?? "warn";
  return /* @__PURE__ */ y.jsxs("li", { style: {
    background: F.surface2,
    border: `1px solid ${i ? F.accent : F.border}`,
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 5
  }, children: [
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
      o && /* @__PURE__ */ y.jsx(
        "input",
        {
          type: "checkbox",
          checked: i,
          onChange: s,
          disabled: a,
          "aria-label": r.issue,
          style: { margin: 0, cursor: a ? "not-allowed" : "pointer" }
        }
      ),
      /* @__PURE__ */ y.jsx("span", { style: Al(c), children: e.analyzeVerdict(r.verdict) }),
      r.prompt && /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.74rem", fontWeight: 600, color: F.text, wordBreak: "break-word", minWidth: 0 }, children: r.prompt })
    ] }),
    /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.74rem", lineHeight: 1.45, color: F.text }, children: r.issue }),
    /* @__PURE__ */ y.jsx("div", { style: { ...Nl, maxHeight: 96, fontSize: "0.7rem", color: F.text2 }, children: r.excerpt }),
    r.correction && /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: [
      /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.04em", color: F.text2 }, children: e.analyzeCorrectionLabel }),
      /* @__PURE__ */ y.jsx("div", { style: { ...Nl, maxHeight: 140, fontSize: "0.7rem" }, children: r.correction })
    ] })
  ] });
}
function $C({ buildReport: e, onCopy: r, onManualFallback: i }) {
  const [o, a] = $.useState(null), [s, c] = $.useState(!1), [d, p] = $.useState(!1), h = $.useCallback(async () => {
    var w;
    const v = e();
    a(v);
    try {
      if (r) await r(v);
      else if ((w = navigator == null ? void 0 : navigator.clipboard) != null && w.writeText) await navigator.clipboard.writeText(v);
      else throw new Error("no clipboard");
      c(!0), p(!1);
    } catch {
      c(!1), p(!0), i == null || i();
    }
  }, [e, r, i]), m = $.useCallback(() => p((v) => !v), []);
  return { report: o, copied: s, revealed: d, copy: h, toggleReveal: m };
}
function BC({ t: e, disabled: r, copy: i }) {
  const { report: o, copied: a, revealed: s } = i, c = $.useRef(null);
  return $.useEffect(() => {
    var d, p;
    s && ((d = c.current) == null || d.focus(), (p = c.current) == null || p.select());
  }, [s]), /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.diagnosticsTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: e.diagnosticsHint }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void i.copy(), disabled: r, style: Dn(r), children: e.diagnosticsCta }),
      o !== null && /* @__PURE__ */ y.jsx("button", { type: "button", onClick: i.toggleReveal, style: qu, children: s ? e.diagnosticsHide : e.diagnosticsShow })
    ] }),
    s && o !== null && /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
      !a && /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.72rem", color: F.text2, lineHeight: 1.4 }, children: e.diagnosticsManualHint }),
      /* @__PURE__ */ y.jsx(
        "textarea",
        {
          ref: c,
          readOnly: !0,
          value: o,
          rows: 12,
          "aria-label": e.diagnosticsTitle,
          onFocus: (d) => d.currentTarget.select(),
          style: { ...Nl, width: "100%", maxHeight: 320, resize: "vertical", boxSizing: "border-box" }
        }
      )
    ] })
  ] });
}
function HC({ tabs: e, activeId: r, onSelect: i, label: o, idPrefix: a }) {
  const s = $.useRef(null), c = $.useCallback((p) => {
    var E, L;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(p.key)) return;
    p.preventDefault();
    const m = e.findIndex((D) => D.id === r), v = e.length - 1, w = p.key === "Home" ? 0 : p.key === "End" ? v : p.key === "ArrowLeft" ? m <= 0 ? v : m - 1 : m >= v ? 0 : m + 1, x = e[w];
    x && (i(x.id), (L = (E = s.current) == null ? void 0 : E.querySelector(`[id="${a}-tab-${x.id}"]`)) == null || L.focus());
  }, [r, a, i, e]), d = e.find((p) => p.id === r) ?? e[0];
  return /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
    /* @__PURE__ */ y.jsx(
      "div",
      {
        ref: s,
        role: "tablist",
        "aria-label": o,
        onKeyDown: c,
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          borderBottom: `1px solid ${F.border}`,
          paddingBottom: 0,
          marginTop: 2
        },
        children: e.map((p) => {
          const h = p.id === (d == null ? void 0 : d.id);
          return /* @__PURE__ */ y.jsxs(
            "button",
            {
              id: `${a}-tab-${p.id}`,
              type: "button",
              role: "tab",
              "aria-selected": h,
              "aria-controls": `${a}-panel-${p.id}`,
              tabIndex: h ? 0 : -1,
              onClick: () => i(p.id),
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                fontSize: "0.79rem",
                fontWeight: h ? 700 : 600,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: h ? F.accent : F.text2,
                // The active marker is a bottom rule flush with the strip's own border,
                // so the selected tab reads as attached to its panel in both themes
                // without depending on a filled background colour.
                boxShadow: h ? `inset 0 -2px 0 0 ${F.accent}` : "none",
                whiteSpace: "nowrap"
              },
              children: [
                p.label,
                p.badge && /* @__PURE__ */ y.jsx(
                  "span",
                  {
                    "aria-hidden": !0,
                    style: {
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      lineHeight: 1.6,
                      minWidth: 16,
                      textAlign: "center",
                      padding: "0 5px",
                      borderRadius: 999,
                      color: p.badgeTone === "bad" ? F.danger : F.text2,
                      border: `1px solid ${p.badgeTone === "bad" ? F.danger : F.border}`
                    },
                    children: p.badge
                  }
                )
              ]
            },
            p.id
          );
        })
      }
    ),
    d && /* @__PURE__ */ y.jsx(
      "div",
      {
        id: `${a}-panel-${d.id}`,
        role: "tabpanel",
        "aria-labelledby": `${a}-tab-${d.id}`,
        tabIndex: 0,
        style: { display: "flex", flexDirection: "column", gap: 10, outline: "none" },
        children: d.content
      }
    )
  ] });
}
function Jp(e) {
  return Math.floor(e * 100 + 1e-6);
}
function qC(e, r) {
  if (!e) return null;
  const i = Math.round(e.bar * 100);
  switch (e.reason) {
    case "qualified":
      return { text: r.codingGateQualified(Jp(e.ratio ?? e.bar), i), tone: "ok" };
    case "below_bar":
      return { text: r.codingGateBelowBar(Jp(e.ratio ?? 0), i), tone: "warn" };
    case "no_eval":
      return { text: r.codingGateNoEval(i), tone: "warn" };
    case "stale_eval":
      return { text: r.codingGateStale(e.evaluatedVersion ?? 0, e.headVersion, i), tone: "warn" };
    default:
      return null;
  }
}
function UC({ gate: e, t: r }) {
  const i = qC(e, r);
  return i ? /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.72rem", lineHeight: 1.5 }, role: "note", "data-testid": "evermind-coding-gate", children: /* @__PURE__ */ y.jsx("span", { style: Al(i.tone), children: i.text }) }) : null;
}
var WC = 1200, Zp = 400, VC = 10, Ks = 20, GC = { web: "web console", vscode: "VS Code sidebar", synapse: "Synapse desktop" };
function io(e, r) {
  const i = e.trim();
  return i.length <= r ? i : `${i.slice(0, r)}
…[truncated ${i.length - r} more characters]`;
}
function gu(e) {
  return `~~~
${e || "(empty)"}
~~~`;
}
function QC(e) {
  return e ? "yes" : "no";
}
function eh(e) {
  return e ? new Date(e).toISOString() : "never";
}
function KC(e) {
  var o;
  const r = [
    "## Model state",
    "",
    `- Version: v${e.version}`,
    `- Seeded: ${QC(e.seeded)}`,
    `- Learning: ${e.mode === "connected" ? "connected" : "frozen"}`,
    `- Serving replies (inference): ${e.inferenceEnabled ? "ON" : "off"}`,
    `- Teacher model: ${e.teacherModel || "none (learns from raw runs)"}`,
    `- Learned contributions: ${e.contributions}`,
    `- Queued (unmerged): ${e.pending}`,
    `- Last learned: ${eh(e.lastLearnedAt)}`
  ];
  e.inherited && r.push(`- INHERITED from project #${e.inheritedFromProjectId ?? "?"} (this build has no Evermind of its own; the console is read-only)`), e.quarantinedAt && r.push(`- QUARANTINED at ${eh(e.quarantinedAt)} — ${((o = e.quarantineReason) == null ? void 0 : o.trim()) || "no reason recorded"}`);
  const i = e.eval;
  if (i) {
    const a = i.delta > 0 ? "improved" : i.delta < 0 ? "REGRESSED" : "flat";
    r.push(`- Regression check on v${i.version}: held-out loss ${i.baseLoss.toFixed(4)} → ${i.newLoss.toFixed(4)} over ${i.evalSize} prior task(s) (${a})`);
  }
  return r;
}
function YC(e) {
  const r = e.samples.filter((o) => o.coherent).length, i = [
    "## Test bench",
    "",
    `- Run: ${e.mode === "readiness" ? "readiness suite (the gate for switching replies on)" : "operator prompt"}`,
    `- Model version: v${e.version}`,
    `- Verdict: ${e.ready ? "WOULD SERVE" : "REFUSED"}`,
    `- Usable answers: ${r} of ${e.samples.length} (pass rate ${Math.round(e.passRate * 100)}%)`,
    ""
  ];
  return e.samples.forEach((o, a) => {
    i.push(`### Sample ${a + 1} — ${o.coherent ? "USABLE" : "REFUSED"}`), i.push(""), i.push(`Prompt: ${o.prompt}`), o.coherent || i.push(`Rejected by: \`${o.failure ?? "unknown"}\` — ${o.detail || "no detail"}`), i.push(""), i.push("Raw output (verbatim):"), i.push(gu(io(o.text, WC))), i.push("");
  }), i;
}
function XC(e) {
  const r = [
    "## Knowledge audit",
    "",
    `- Memories reviewed: ${e.analyzed}`,
    `- Graded by: ${e.model ?? "local coherence screen only (no frontier reviewer)"}`,
    `- Findings: ${e.findings.length}`
  ];
  if (e.warning && r.push(`- Partial audit: ${e.warning}`), r.push(""), e.findings.length === 0)
    return r.push("Nothing flagged."), r.push(""), r;
  for (const i of e.findings.slice(0, Ks))
    r.push(`### Memory #${i.id} — ${i.verdict} (${i.source})`), r.push(""), i.prompt && r.push(`Task: ${i.prompt}`), r.push(`Issue: ${i.issue}`), r.push(""), r.push("As learned:"), r.push(gu(io(i.excerpt, Zp))), i.correction && (r.push(""), r.push("Proposed correction:"), r.push(gu(io(i.correction, Zp)))), r.push("");
  return e.findings.length > Ks && (r.push(`_…and ${e.findings.length - Ks} more finding(s) not included._`), r.push("")), r;
}
function JC(e) {
  const r = ["## Everminds under this project", ""];
  return e.forEach((i, o) => {
    const a = [
      i.seeded ? `v${i.version}` : "not seeded",
      i.mode === "connected" ? "connected" : "frozen",
      i.inferenceEnabled ? "serving replies" : "not serving"
    ].join(", ");
    r.push(`- ${o === 0 ? "[this project]" : "[IDE build]"} ${i.name} (project #${i.projectId}) — ${a}`);
  }), r.push(""), r;
}
function ZC(e) {
  const r = e.recent.slice(0, VC), i = [`## Recently learned (${r.length} of ${e.recent.length} shown)`, ""];
  if (r.length === 0)
    return i.push("Nothing learned yet."), i.push(""), i;
  for (const o of r) {
    const a = new Date(o.at).toISOString(), s = uo(o), c = s.state === "distilled" ? `distilled by ${s.teacherModel ?? "a teacher"}` : s.state === "fault" ? `NOT distilled (${s.reason}${s.detail ? `: ${s.detail}` : ""})` : s.state === "self" ? "self-learned from run output" : "weight delta", d = o.text && jm(o.text) ? " · ⚠ narration-like" : "";
    i.push(`- v${o.version} ×${o.weight} ${a} [${o.kind}] ${c}${d}`), o.prompt && i.push(`  - task: ${io(o.prompt, 200)}`), o.text && i.push(`  - learned: ${io(o.text, 500).replace(/\n/g, " ")}`);
  }
  return i.push(""), i;
}
var eE = [
  /\blet me\b/i,
  /\bi('ll| will)\b/i,
  /\bnow (let|i|the)\b/i,
  /\blooking (back|at)\b/i,
  /\btool calls?\b/i,
  /\brun_command\b/i,
  /\bgit_status\b/i,
  /\bsettled\b/i,
  /\brather than (just )?assert\b/i,
  /\bmy (previous|last) turn\b/i
];
function jm(e) {
  const r = e.trim();
  if (r.length < 40) return !1;
  let i = 0;
  for (const o of eE) o.test(r) && (i += 1);
  return i >= 2;
}
function tE(e) {
  const r = e.codingGate;
  if (!r)
    return [
      "## Coding gate (IDE)",
      "",
      "_Not reported by this server — upgrade the API to include `codingGate` on the console payload._",
      ""
    ];
  const i = r.ratio == null ? null : Math.round(r.ratio * 100), o = Math.round(r.bar * 100), a = [
    "## Coding gate (IDE)",
    "",
    `- Qualified for coding turns: ${r.qualified ? "yes" : "no"}`,
    `- Reason: \`${r.reason}\``,
    `- Bar: ${o}% of frontier baseline on this head version`
  ];
  return i != null && a.push(`- Score vs baseline: ${i}%`), r.evaluatedVersion != null && a.push(`- Eval recorded for: v${r.evaluatedVersion} (head is v${r.headVersion})`), r.baselineModel && a.push(`- Baseline model: ${r.baselineModel}`), r.dataset && a.push(`- Dataset: ${r.dataset}`), a.push(""), a;
}
function nE(e) {
  const r = e.recent;
  let i = 0, o = 0, a = 0, s = 0, c = 0;
  for (const p of r) {
    const h = uo(p);
    if (p.kind === "delta" || h.state === "delta") {
      s += 1;
      continue;
    }
    h.state === "distilled" ? i += 1 : h.state === "fault" ? a += 1 : o += 1, p.text && jm(p.text) && (c += 1);
  }
  const d = [
    "## Learn quality",
    "",
    `- Teacher pinned: ${e.teacherModel ? e.teacherModel : "no — raw runs self-learn into the head"}`,
    `- Recent mix (of ${r.length}): distilled ${i} · self-learned ${o} · teacher-fault ${a} · weight-delta ${s}`,
    `- Narration-like self-learns (heuristic): ${c} of ${r.length}`
  ];
  return !e.teacherModel && o > 0 && d.push("- Signal: teacher is unset while self-learned run text is landing — pin a frontier teacher before expecting coherence/coding gates to recover."), c > 0 && d.push(`- Signal: ${c} recent memor(y/ies) look like agent mid-turn narration ("let me…", tool-call play-by-play), not clean task→answer exemplars.`), e.eval && e.eval.delta < 0 && o + c > i && d.push("- Signal: held-out loss REGRESSED while learning is mostly raw/self — stop absorbing run chatter or pin a teacher before more merges."), d.push(""), d;
}
function rE(e, r) {
  const i = r ? r.ready ? "PASS" : "FAIL" : "not run this session", o = e.codingGate ? e.codingGate.qualified ? "PASS" : `FAIL (${e.codingGate.reason})` : "unknown (server omitted codingGate)";
  return [
    "## Path to serve (local LLM)",
    "",
    `- [ ] Coherence / quarantine cleared: ${e.quarantinedAt ? "BLOCKED (quarantined)" : "ok"}`,
    `- [ ] Readiness probe: ${i}`,
    `- [ ] Teacher pinned for clean exemplars: ${e.teacherModel ? `ok (${e.teacherModel})` : "MISSING"}`,
    `- [ ] Coding gate (≥90% frontier): ${o}`,
    `- [ ] Inference switch: ${e.inferenceEnabled ? "ON" : "off"}`,
    ""
  ];
}
function iE(e) {
  const { data: r, projectName: i, host: o, targets: a, probe: s, analysis: c, error: d, now: p } = e, h = [
    `# Evermind diagnostics${i ? ` — ${i}` : ""}`,
    "",
    `- Generated: ${new Date(p).toISOString()}`,
    `- Surface: ${GC[o]}`,
    ""
  ];
  if (d && h.push("## Last error", "", d, ""), !r)
    return h.push("## Model state", "", "The console could not load this project’s Evermind — no head state is available.", ""), h.join(`
`);
  h.push(...KC(r), "");
  const m = _m({
    seeded: r.seeded,
    inferenceEnabled: r.inferenceEnabled,
    mode: r.mode,
    pending: r.pending,
    teacherModel: r.teacherModel,
    quarantinedAt: r.quarantinedAt,
    recent: r.recent,
    eval: r.eval,
    probe: s
  });
  return h.push("## Recommended next action", "", `- ${m.title}`, `- Why: ${m.detail}`, `- Go to: ${m.destination}`, ""), h.push(...rE(r, s)), h.push(...tE(r)), h.push(...nE(r)), a && a.length > 0 && h.push(...JC(a)), s ? h.push(...YC(s)) : h.push("## Test bench", "", "_Not run in this session — run readiness (Test → Readiness check) before exporting so the report includes verbatim model output._", ""), c && h.push(...XC(c)), h.push(...ZC(r)), h.join(`
`);
}
var th = 3e3, oE = 12e4;
function lE({ adapter: e, canManage: r, labels: i, refreshMs: o = 2e4, projectName: a, showRecent: s = !0, showHeaderRefresh: c = !0, refreshSignal: d, onValidate: p, host: h = "web" }) {
  var Bt, St;
  const m = $.useMemo(() => ({ ...Em, ...i ?? {} }), [i]), [v, w] = $.useState(null), [x, E] = $.useState(null), [L, D] = $.useState([]), [z, U] = $.useState(null), [B, ne] = $.useState(""), [Z, j] = $.useState(""), [Y, se] = $.useState(""), [re, I] = $.useState(!1), [te, ie] = $.useState(!1), [xe, oe] = $.useState(null), [X, ge] = $.useState(null), [Ce, q] = $.useState("good"), [N, b] = $.useState(null), [_, O] = $.useState(!1), [S, le] = $.useState("teach"), [ye, he] = $.useState(null), [Re, _e] = $.useState(null), [Ne, Be] = $.useState(!1), He = $.useCallback(async () => {
    var fe;
    const ke = (fe = e.loadTargets) == null ? void 0 : fe.call(e).catch(() => null);
    try {
      const Ee = await e.loadData();
      w(Ee), Be(!1);
    } catch {
      w(null), Be(!0);
    } finally {
      O(!0);
    }
    if (ke) {
      const Ee = await ke;
      Ee && E(Ee);
    }
  }, [e]);
  $.useEffect(() => {
    O(!1), He();
  }, [He]), $.useEffect(() => {
    if (!r) return;
    let ke = !1;
    return e.loadSeedModels().then((fe) => {
      ke || (D(fe), ne((Ee) => {
        var it;
        return Ee || (((it = fe[0]) == null ? void 0 : it.slug) ?? "");
      }));
    }).catch(() => {
    }), e.loadTeacherOptions().then((fe) => {
      ke || U(fe);
    }).catch(() => {
    }), () => {
      ke = !0;
    };
  }, [e, r]), $.useEffect(() => {
    if (!o) return;
    const ke = () => typeof document < "u" && document.visibilityState === "hidden", fe = setInterval(() => {
      !re && !ke() && He();
    }, o), Ee = () => {
      !re && !ke() && He();
    };
    return typeof document < "u" && document.addEventListener("visibilitychange", Ee), () => {
      clearInterval(fe), typeof document < "u" && document.removeEventListener("visibilitychange", Ee);
    };
  }, [o, re, He]);
  const Sn = $.useRef(d);
  $.useEffect(() => {
    d == null || d === Sn.current || (Sn.current = d, He());
  }, [d, He]);
  const W = $.useCallback(async (ke) => {
    const fe = ke.trim();
    if (!(fe.length < 3)) {
      ie(!0), b(null), ge(null);
      try {
        const Ee = await e.validate(fe);
        oe(Ee), p == null || p(Ee);
      } catch (Ee) {
        b(Ee instanceof Error ? Ee.message : m.errorGeneric);
      } finally {
        ie(!1);
      }
    }
  }, [e, p, m.errorGeneric]), Ae = $.useCallback(() => {
    oe(null), p == null || p(null);
  }, [p]), Ue = $.useRef(null), We = $.useRef(!0);
  $.useEffect(() => (We.current = !0, () => {
    We.current = !1, Ue.current && clearTimeout(Ue.current);
  }), []);
  const Jt = $.useCallback((ke) => {
    if (ke.state === "dropped") return { text: m.taughtDropped, tone: "warn" };
    if (ke.state !== "merged") return { text: m.taughtStillPending, tone: "warn" };
    const fe = uo({
      kind: ke.kind ?? "text",
      ...ke.distilled !== void 0 ? { distilled: ke.distilled } : {},
      ...ke.teacherModel ? { teacherModel: ke.teacherModel } : {},
      ...ke.skipReason ? { skipReason: ke.skipReason } : {},
      ...ke.skipDetail ? { skipDetail: ke.skipDetail } : {},
      ...ke.attemptedTeacherModel ? { attemptedTeacherModel: ke.attemptedTeacherModel } : {}
    }), Ee = ke.version ?? 0;
    return fe.state === "distilled" ? { text: m.taughtDistilled(fe.teacherModel ?? "", Ee), tone: "good" } : fe.state === "fault" ? { text: m.taughtTeacherFault(fe.teacherModel ?? "", fe.reason), tone: "warn" } : { text: m.taughtSelf(Ee), tone: "good" };
  }, [m]), jr = $.useCallback((ke) => {
    const fe = e.teachStatus;
    if (!fe || !Number.isInteger(ke) || ke <= 0) return;
    Ue.current && clearTimeout(Ue.current);
    const Ee = Date.now() + oE, it = async () => {
      let tt = null;
      try {
        tt = await fe(ke);
      } catch {
        tt = null;
      }
      if (We.current && !(!tt || tt.state === "unknown")) {
        if (tt.state === "merged" || tt.state === "dropped") {
          const Rr = Jt(tt);
          ge(Rr.text), q(Rr.tone), tt.state === "merged" && He();
          return;
        }
        if (Date.now() >= Ee) {
          ge(m.taughtStillPending), q("warn");
          return;
        }
        Ue.current = setTimeout(() => {
          it();
        }, th);
      }
    };
    Ue.current = setTimeout(() => {
      it();
    }, th);
  }, [e, Jt, He, m.taughtStillPending]), dt = $.useCallback(async (ke, fe) => {
    I(!0), b(null), ge(null), q("good");
    try {
      await ke(), await He(), fe && ge(fe);
    } catch (Ee) {
      b(Ee instanceof Error ? Ee.message : m.errorGeneric);
    } finally {
      I(!1);
    }
  }, [He, m.errorGeneric]), sn = $.useId(), un = $.useCallback(() => iE({
    data: v,
    projectName: a,
    host: h,
    targets: x,
    probe: ye,
    analysis: Re,
    error: N,
    now: Date.now()
  }), [v, a, h, x, ye, Re, N]), cn = $C({
    buildReport: un,
    onCopy: e.copyText,
    onManualFallback: () => le("maintain")
  });
  if (!_) return /* @__PURE__ */ y.jsx(Ys, { "aria-busy": !0, children: /* @__PURE__ */ y.jsx("p", { style: { margin: 0, color: F.text2, fontSize: "0.82rem" }, children: m.loading }) });
  const dn = !!(v != null && v.seeded), fn = (v == null ? void 0 : v.mode) === "offline-frozen", Cn = !!(v != null && v.inherited), H = !!(v != null && v.quarantinedAt), ee = ((Bt = v == null ? void 0 : v.quarantineReason) == null ? void 0 : Bt.trim()) || "", ve = v ? _m({
    seeded: v.seeded,
    inferenceEnabled: v.inferenceEnabled,
    mode: v.mode,
    pending: v.pending,
    teacherModel: v.teacherModel,
    quarantinedAt: v.quarantinedAt,
    recent: v.recent,
    eval: v.eval,
    probe: ye
  }) : null, Le = a == null ? void 0 : a.trim(), De = /* @__PURE__ */ y.jsxs("header", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
    /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, style: { fontSize: "1.05rem" }, children: "🧠" }),
    /* @__PURE__ */ y.jsx("h3", { style: { margin: 0, fontSize: "0.95rem", fontWeight: 700, color: F.text }, children: m.title }),
    Le && /* @__PURE__ */ y.jsxs("span", { style: { fontSize: "0.8rem", color: F.text2 }, title: Le, children: [
      "· ",
      Le
    ] }),
    !Ne && /* @__PURE__ */ y.jsx("span", { style: zC(dn), children: dn ? m.statusSeeded((v == null ? void 0 : v.version) ?? 0) : m.statusUnseeded }),
    !Ne && dn && /* @__PURE__ */ y.jsx(sE, { t: m, evalPoint: (v == null ? void 0 : v.eval) ?? null }),
    !Ne && H && /* @__PURE__ */ y.jsxs("span", { style: vE, title: m.quarantinedHint(ee), children: [
      "⚠ ",
      m.quarantinedBadge
    ] }),
    cn.copied && /* @__PURE__ */ y.jsx("span", { role: "status", style: { fontSize: "0.72rem", color: F.accent }, children: m.diagnosticsCopied }),
    /* @__PURE__ */ y.jsxs("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }, children: [
      /* @__PURE__ */ y.jsxs(
        "button",
        {
          type: "button",
          onClick: () => void cn.copy(),
          style: { ...mu, marginLeft: 0, fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: 4 },
          title: m.diagnosticsCta,
          "aria-label": m.diagnosticsCta,
          children: [
            /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: cn.copied ? "✓" : "⧉" }),
            m.diagnosticsTitle
          ]
        }
      ),
      c && /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void He(), disabled: re, style: { ...mu, marginLeft: 0 }, title: m.refresh, "aria-label": m.refresh, children: "↻" })
    ] })
  ] });
  if (Ne)
    return /* @__PURE__ */ y.jsxs(Ys, { "aria-label": m.title, children: [
      De,
      /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: F.danger }, role: "alert", children: m.errorGeneric }),
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => void He(), disabled: re, style: ri(re), children: m.refresh })
    ] });
  const Ke = [];
  if (v && dn && !Cn) {
    const ke = v;
    if (Ke.push({
      id: "teach",
      label: m.tabTeach,
      // The queue depth belongs here: "3 waiting" is a prompt to press Learn now, and
      // it is the one number that changes while you are on another tab.
      ...ke.pending > 0 ? { badge: String(ke.pending), badgeTone: "info" } : {},
      content: /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
        /* @__PURE__ */ y.jsx(
          cE,
          {
            t: m,
            canManage: r,
            busy: re,
            opts: z,
            value: ke.teacherModel ?? "",
            onChange: (fe) => dt(() => e.setTeacher(fe || null))
          }
        ),
        /* @__PURE__ */ y.jsx(
          dE,
          {
            t: m,
            busy: re,
            validating: te,
            teacherModel: ke.teacherModel ?? "",
            prompt: Z,
            text: Y,
            onPrompt: j,
            onText: se,
            onTeach: () => dt(
              async () => {
                const fe = Z.trim(), Ee = Y.trim(), it = ke.teacherModel && Ee.length < 20 && fe.length >= 20 ? await e.teach(fe, fe) : await e.teach(Ee, fe || void 0);
                se(""), j(""), it != null && it.contributionId && jr(it.contributionId);
              },
              m.taught
            ),
            onValidate: () => W(ke.teacherModel ? Z : Z.trim() || Y)
          }
        ),
        xe && /* @__PURE__ */ y.jsx(pE, { t: m, result: xe, onClear: Ae }),
        r && /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ y.jsx(
            "button",
            {
              type: "button",
              disabled: re || fn,
              onClick: () => dt(async () => {
                const fe = await e.flush();
                ge(fe.merged > 0 ? m.flushedN(fe.merged, fe.version) : m.flushedNone);
              }, void 0),
              style: ri(re || fn),
              children: re ? m.flushing : m.flushCta
            }
          ),
          ke.pending > 0 && /* @__PURE__ */ y.jsxs("span", { style: { fontSize: "0.74rem", color: F.text2 }, children: [
            m.pendingLabel,
            ": ",
            ke.pending
          ] })
        ] }),
        r && e.importMemory && /* @__PURE__ */ y.jsx(
          fE,
          {
            t: m,
            busy: re,
            frozen: fn,
            onImport: () => dt(async () => {
              const fe = await e.importMemory();
              fe && ge(
                fe.absorbed > 0 ? m.importDone(fe.absorbed, fe.version, fe.compacted, (fe.bytesSaved / 1024).toFixed(1)) : m.importNothing
              );
            })
          }
        )
      ] })
    }), e.probe) {
      const fe = ye ? !ye.ready : !1;
      Ke.push({
        id: "test",
        label: m.tabTest,
        // A failed readiness check follows you to the other tabs. A refusal you can only
        // see while standing on the tab that found it is a refusal you forget.
        ...fe ? { badge: "!", badgeTone: "bad" } : {},
        content: /* @__PURE__ */ y.jsx(
          PC,
          {
            t: m,
            disabled: !r || re,
            onProbe: (Ee) => e.probe(Ee),
            result: ye,
            onResult: he
          }
        )
      });
    }
    if (r && e.analyze) {
      const fe = (Re == null ? void 0 : Re.findings.length) ?? 0;
      Ke.push({
        id: "check",
        label: m.tabCheck,
        ...fe > 0 ? { badge: String(fe), badgeTone: "bad" } : {},
        content: /* @__PURE__ */ y.jsx(
          MC,
          {
            t: m,
            disabled: re,
            onAnalyze: () => e.analyze(),
            ...e.applyFindings ? { onApply: (Ee) => e.applyFindings(Ee) } : {},
            onRepaired: () => void He(),
            analysis: Re,
            onAnalysis: _e
          }
        )
      });
    }
    Ke.push({
      id: "maintain",
      label: m.tabMaintain,
      content: /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
        r && /* @__PURE__ */ y.jsx(
          IC,
          {
            t: m,
            disabled: re,
            seedModels: L,
            ...e.reseed ? {
              onReseed: (fe) => dt(async () => {
                const Ee = await e.reseed(fe);
                ge(m.reseedDone(Ee.version));
              })
            } : {},
            ...e.reindex ? {
              onReindex: () => dt(async () => {
                const fe = await e.reindex();
                ge(m.reindexDone(fe.reindexed));
              })
            } : {},
            ...e.cleanup ? {
              onCleanup: () => dt(async () => {
                const fe = await e.cleanup();
                ge(m.cleanupDone(fe.discarded, fe.cachedAnswers));
              })
            } : {}
          }
        ),
        /* @__PURE__ */ y.jsx(BC, { t: m, disabled: re, copy: cn })
      ] })
    });
  }
  return /* @__PURE__ */ y.jsxs(Ys, { "aria-label": m.title, children: [
    De,
    /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: F.text2 }, children: m.description }),
    !r && /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.72rem", color: F.text2, fontStyle: "italic" }, children: m.managerOnlyHint }),
    Cn && /* @__PURE__ */ y.jsx(
      "p",
      {
        style: { margin: 0, fontSize: "0.72rem", lineHeight: 1.5, color: F.text2, fontStyle: "italic" },
        role: "note",
        children: m.inheritedHint
      }
    ),
    H && /* @__PURE__ */ y.jsx("p", { style: $l, role: "alert", children: m.quarantinedHint(ee) }),
    !Ne && /* @__PURE__ */ y.jsx(UC, { gate: v == null ? void 0 : v.codingGate, t: m }),
    ve && /* @__PURE__ */ y.jsx(aE, { action: ve, canAct: r && !re && !Cn, onAction: () => {
      ve.id === "test" ? le("test") : ve.id === "teacher" || ve.id === "merge" || ve.id === "learn" ? le("teach") : ve.id === "check" ? le("check") : ve.id === "enable" && dt(() => e.setInference(!0));
    } }),
    x && /* @__PURE__ */ y.jsx(hE, { t: m, targets: x }),
    Cn ? (
      // INHERITED — read-only. This build has no `project_evermind` row of its own;
      // it is displaying its container project's. Every write endpoint keeps exact-id
      // semantics, so a seed/toggle/teach issued here would post to a row that does
      // not exist: zero rows updated, HTTP OK, nothing changes, and the panel keeps
      // rendering the container's unchanged stats. Rendering the stats WITHOUT the
      // controls is the honest surface — the model is genuinely shared and genuinely
      // shown; it is just not managed from here.
      /* @__PURE__ */ y.jsx(nh, { t: m, data: v })
    ) : dn ? /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
      /* @__PURE__ */ y.jsx(nh, { t: m, data: v }),
      /* @__PURE__ */ y.jsx(
        rh,
        {
          label: m.inferenceLabel,
          hint: m.inferenceHint,
          on: !!(v != null && v.inferenceEnabled),
          onText: m.on,
          offText: m.off,
          disabled: !r || re,
          onToggle: () => dt(() => e.setInference(!(v != null && v.inferenceEnabled)))
        }
      ),
      /* @__PURE__ */ y.jsx(
        rh,
        {
          label: m.learningLabel,
          hint: m.learningHint,
          on: !fn,
          onText: m.connected,
          offText: m.frozen,
          disabled: !r || re,
          onToggle: () => dt(() => e.setMode(fn ? "connected" : "offline-frozen"))
        }
      ),
      /* @__PURE__ */ y.jsx(
        HC,
        {
          tabs: Ke,
          activeId: Ke.some((ke) => ke.id === S) ? S : ((St = Ke[0]) == null ? void 0 : St.id) ?? "teach",
          onSelect: le,
          label: m.tabsLabel,
          idPrefix: `ev${sn}`
        }
      ),
      s && /* @__PURE__ */ y.jsx(mE, { t: m, entries: (v == null ? void 0 : v.recent) ?? [] })
    ] }) : /* @__PURE__ */ y.jsx(
      uE,
      {
        t: m,
        canManage: r,
        busy: re,
        models: L,
        selectedSlug: B,
        onSelect: ne,
        onSeed: () => B && dt(() => e.seedFromModel(B))
      }
    ),
    X && /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.74rem", lineHeight: 1.5, color: Ce === "warn" ? F.warnText : F.accent }, role: "status", children: X }),
    N && /* @__PURE__ */ y.jsx("p", { style: { margin: 0, fontSize: "0.76rem", color: F.danger }, role: "alert", children: N })
  ] });
}
function aE({ action: e, canAct: r, onAction: i }) {
  const o = e.tone === "danger" ? F.danger : e.tone === "attention" ? F.warnText : e.tone === "good" ? F.accent : F.text2, a = !["seed", "none"].includes(e.id);
  return /* @__PURE__ */ y.jsxs("section", { "aria-label": "Recommended next action", style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "6px 12px", alignItems: "center", padding: "11px 12px", border: `1px solid ${o}`, borderRadius: 10, background: F.surface2 }, children: [
    /* @__PURE__ */ y.jsx("span", { style: { gridColumn: "1 / -1", color: o, fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }, children: "Recommended next action" }),
    /* @__PURE__ */ y.jsxs("div", { style: { minWidth: 0 }, children: [
      /* @__PURE__ */ y.jsx("strong", { style: { display: "block", color: F.text, fontSize: "0.82rem" }, children: e.title }),
      /* @__PURE__ */ y.jsx("p", { style: { margin: "3px 0 0", color: F.text2, fontSize: "0.72rem", lineHeight: 1.45 }, children: e.detail }),
      /* @__PURE__ */ y.jsxs("small", { style: { display: "block", marginTop: 5, color: o, fontSize: "0.66rem", fontWeight: 700 }, children: [
        "Go to: ",
        e.destination
      ] })
    ] }),
    a && /* @__PURE__ */ y.jsx("button", { type: "button", disabled: !r, onClick: i, style: { border: `1px solid ${o}`, borderRadius: 8, padding: "7px 10px", background: "transparent", color: o, fontSize: "0.7rem", fontWeight: 800, cursor: r ? "pointer" : "not-allowed", opacity: r ? 1 : 0.55 }, children: e.cta })
  ] });
}
function sE({ t: e, evalPoint: r }) {
  if (!r || !(r.baseLoss > 0)) return null;
  const i = r.delta / r.baseLoss, o = Math.abs(i) * 100, a = o < 0.5 ? "flat" : i > 0 ? "up" : "down", s = a === "up" ? "▲" : a === "down" ? "▼" : "≈", c = a === "up" ? "#22c55e" : a === "down" ? "#f87171" : F.text2, d = a === "flat" ? e.evalFlat : e.evalDelta(o.toFixed(1)), p = e.evalTooltip(r.version, r.baseLoss.toFixed(3), r.newLoss.toFixed(3), r.evalSize);
  return /* @__PURE__ */ y.jsxs(
    "span",
    {
      title: p,
      "aria-label": p,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 700,
        color: c,
        border: `1px solid ${c}`,
        borderRadius: 999,
        padding: "2px 8px"
      },
      children: [
        /* @__PURE__ */ y.jsx("span", { "aria-hidden": !0, children: s }),
        d
      ]
    }
  );
}
function Ys({ children: e, ...r }) {
  return /* @__PURE__ */ y.jsx(
    "section",
    {
      ...r,
      style: {
        border: `1px solid ${F.border}`,
        borderRadius: 10,
        background: F.surface,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10
      },
      children: e
    }
  );
}
function uE({
  t: e,
  canManage: r,
  busy: i,
  models: o,
  selectedSlug: a,
  onSelect: s,
  onSeed: c
}) {
  return r ? o.length === 0 ? /* @__PURE__ */ y.jsx("p", { style: In, children: e.noModels }) : /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
    /* @__PURE__ */ y.jsx("label", { style: AC, children: e.pickModelLabel }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [
      /* @__PURE__ */ y.jsx("select", { value: a, onChange: (d) => s(d.target.value), disabled: i, style: { ...ir, flex: "1 1 200px" }, children: o.map((d) => /* @__PURE__ */ y.jsx("option", { value: d.slug, style: ro, children: d.name }, d.slug)) }),
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: c, disabled: i || !a, style: ri(i || !a), children: i ? e.working : e.enableCta })
    ] })
  ] }) : /* @__PURE__ */ y.jsx("p", { style: In, children: e.notSetUp });
}
function nh({ t: e, data: r }) {
  const i = r.lastLearnedAt ? e.formatWhen(new Date(r.lastLearnedAt).getTime()) : e.neverLearned, o = [
    { label: e.versionLabel, value: `v${r.version}` },
    { label: e.contributionsLabel, value: String(r.contributions) },
    { label: e.pendingLabel, value: String(r.pending) },
    { label: e.lastLearnedLabel, value: i }
  ];
  return /* @__PURE__ */ y.jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: 8 }, children: o.map((a) => /* @__PURE__ */ y.jsxs("div", { style: { background: F.surface2, border: `1px solid ${F.border}`, borderRadius: 8, padding: "8px 10px" }, children: [
    /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.04em", color: F.text2 }, children: a.label }),
    /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.9rem", fontWeight: 700, color: F.text, marginTop: 2, wordBreak: "break-word" }, children: a.value })
  ] }, a.label)) });
}
function rh({
  label: e,
  hint: r,
  on: i,
  disabled: o,
  onToggle: a,
  onText: s,
  offText: c
}) {
  return /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }, children: [
    /* @__PURE__ */ y.jsxs("div", { style: { flex: "1 1 200px", minWidth: 0 }, children: [
      /* @__PURE__ */ y.jsx("div", { style: Xt, children: e }),
      /* @__PURE__ */ y.jsx("div", { style: bn, children: r })
    ] }),
    /* @__PURE__ */ y.jsx(
      "button",
      {
        type: "button",
        onClick: a,
        disabled: o,
        "aria-pressed": i,
        style: {
          padding: "6px 14px",
          fontSize: "0.78rem",
          fontWeight: 700,
          borderRadius: 999,
          border: `1px solid ${i ? F.accent : F.border}`,
          background: i ? F.accent : F.surface2,
          color: i ? "#fff" : F.text2,
          cursor: o ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
          opacity: o ? 0.7 : 1
        },
        children: i ? s : c
      }
    )
  ] });
}
function cE({
  t: e,
  canManage: r,
  busy: i,
  opts: o,
  value: a,
  onChange: s
}) {
  const c = (o == null ? void 0 : o.models) ?? [], d = a && !c.includes(a) ? [a, ...c] : c;
  return /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ y.jsxs("div", { children: [
      /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.teacherLabel }),
      /* @__PURE__ */ y.jsx("div", { style: bn, children: e.teacherHint })
    ] }),
    r ? o && !o.isPaid ? /* @__PURE__ */ y.jsx("p", { style: In, children: e.teacherPaidOnly }) : /* @__PURE__ */ y.jsxs("select", { value: a, onChange: (p) => s(p.target.value), disabled: i, "aria-label": e.teacherLabel, style: { ...ir, maxWidth: 340 }, children: [
      /* @__PURE__ */ y.jsx("option", { value: "", style: ro, children: e.teacherNone }),
      d.map((p) => /* @__PURE__ */ y.jsx("option", { value: p, style: ro, children: p }, p))
    ] }) : /* @__PURE__ */ y.jsx("div", { style: { ...ir, color: F.text2 }, children: a || e.teacherNone }),
    a && /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.72rem", lineHeight: 1.4, color: F.accent, background: F.surface2, border: `1px solid ${F.border}`, borderRadius: 6, padding: "6px 8px" }, children: e.teacherActiveHint(a) })
  ] });
}
function dE({
  t: e,
  busy: r,
  validating: i,
  prompt: o,
  text: a,
  onPrompt: s,
  onText: c,
  onTeach: d,
  onValidate: p,
  teacherModel: h
}) {
  const m = !!h, v = m ? o.trim().length >= 20 : a.trim().length >= 20, w = (m ? o : o.trim() || a).trim().length >= 3;
  return /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: m ? e.teachTeacherTitle : e.teachTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: m ? e.teachTeacherHint(h) : e.teachHint }),
    m ? /* @__PURE__ */ y.jsx("textarea", { value: o, onChange: (x) => s(x.target.value), disabled: r, placeholder: e.teachTaskPlaceholder, rows: 3, style: { ...ir, width: "100%", resize: "vertical", fontFamily: "inherit" } }) : /* @__PURE__ */ y.jsxs(y.Fragment, { children: [
      /* @__PURE__ */ y.jsx("input", { value: o, onChange: (x) => s(x.target.value), disabled: r, placeholder: e.teachPromptPlaceholder, style: { ...ir, width: "100%" } }),
      /* @__PURE__ */ y.jsx("textarea", { value: a, onChange: (x) => c(x.target.value), disabled: r, placeholder: e.teachTextPlaceholder, rows: 3, style: { ...ir, width: "100%", resize: "vertical", fontFamily: "inherit" } })
    ] }),
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: d, disabled: r || !v, style: ri(r || !v), children: r ? e.teaching : m ? e.teachTeacherCta : e.teachCta }),
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: p, disabled: r || i || !w, style: Dn(r || i || !w), title: e.validateHint, children: i ? e.validating : e.validateCta })
    ] })
  ] });
}
function fE({ t: e, busy: r, frozen: i, onImport: o }) {
  const a = r || i;
  return /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.importTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: e.importHint }),
    /* @__PURE__ */ y.jsx("button", { type: "button", onClick: o, disabled: a, style: { ...Dn(a), alignSelf: "flex-start" }, children: r ? e.importing : e.importCta })
  ] });
}
function pE({ t: e, result: r, onClear: i }) {
  return /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, background: F.surface2, border: `1px solid ${F.border}`, borderRadius: 8, padding: "10px 12px" }, children: [
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("span", { style: { ...Xt, flex: 1, minWidth: 0 }, children: e.validateResultTitle(r.prompt) }),
      /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.64rem", fontWeight: 600, color: F.text2, border: `1px solid ${F.border}`, borderRadius: 999, padding: "1px 8px" }, children: e.validateMethod(r.method) }),
      /* @__PURE__ */ y.jsx("button", { type: "button", onClick: i, style: { ...mu, marginLeft: 0 }, children: e.validateClear })
    ] }),
    r.matches.length === 0 ? /* @__PURE__ */ y.jsx("p", { style: In, children: e.validateEmpty }) : /* @__PURE__ */ y.jsx("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: r.matches.map((o) => {
      const a = o.id === r.primaryId, s = Math.round(o.score * 100);
      return /* @__PURE__ */ y.jsxs("li", { style: { display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${a ? F.accent : F.border}`, borderRadius: 6, padding: "6px 8px", background: F.surface }, children: [
        /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
          a && /* @__PURE__ */ y.jsx("span", { style: Uu(!1), children: e.validatePrimaryBadge }),
          /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.68rem", color: F.text2 }, children: e.versionTag(o.version) }),
          /* @__PURE__ */ y.jsx("span", { style: { marginLeft: "auto", fontSize: "0.68rem", fontWeight: 700, color: F.accent }, children: e.validateScore(s) })
        ] }),
        /* @__PURE__ */ y.jsx("div", { style: { height: 4, borderRadius: 999, background: F.border, overflow: "hidden" }, children: /* @__PURE__ */ y.jsx("div", { style: { width: `${s}%`, height: "100%", background: F.accent } }) }),
        o.prompt && /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.74rem", fontWeight: 600, color: F.text, wordBreak: "break-word" }, children: o.prompt }),
        o.text && /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.72rem", color: F.text2, lineHeight: 1.4, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 54, overflow: "hidden" }, children: o.text })
      ] }, o.id);
    }) })
  ] });
}
function hE({ t: e, targets: r }) {
  return /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.targetsTitle }),
    /* @__PURE__ */ y.jsx("div", { style: bn, children: e.targetsHint }),
    r.length === 0 ? /* @__PURE__ */ y.jsx("p", { style: In, children: e.targetsEmpty }) : /* @__PURE__ */ y.jsx("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: r.map((i, o) => /* @__PURE__ */ y.jsxs(
      "li",
      {
        style: { background: F.surface2, border: `1px solid ${F.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
        children: [
          /* @__PURE__ */ y.jsx("span", { style: Uu(!1), children: o === 0 ? e.targetSelfBadge : e.targetBuildBadge }),
          /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.78rem", fontWeight: 600, color: F.text, wordBreak: "break-word", minWidth: 0 }, children: i.name }),
          /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.68rem", color: F.text2 }, children: e.targetProjectId(i.projectId) }),
          /* @__PURE__ */ y.jsxs("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ y.jsx("span", { style: Xs, children: i.seeded ? e.targetSeeded(i.version) : e.targetUnseeded }),
            /* @__PURE__ */ y.jsx("span", { style: Xs, children: i.mode === "connected" ? e.targetConnected : e.targetFrozen }),
            i.inferenceEnabled && /* @__PURE__ */ y.jsx("span", { style: { ...Xs, color: F.accent, borderColor: F.accent }, children: e.targetInferenceOn })
          ] })
        ]
      },
      i.projectId
    )) })
  ] });
}
function mE({ t: e, entries: r }) {
  return /* @__PURE__ */ y.jsxs("div", { style: sr, children: [
    /* @__PURE__ */ y.jsx("div", { style: Xt, children: e.inspectTitle }),
    r.length === 0 ? /* @__PURE__ */ y.jsx("p", { style: In, children: e.inspectEmpty }) : /* @__PURE__ */ y.jsx("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: r.map((i) => /* @__PURE__ */ y.jsx(gE, { t: e, entry: i }, i.id)) })
  ] });
}
function gE({ t: e, entry: r }) {
  const [i, o] = $.useState(!1), a = uo(r), s = a.state === "fault", c = r.kind === "delta" ? e.deltaEntry : s ? "" : r.text ?? "", d = r.kind !== "delta" && (!!r.prompt || !!r.text || s);
  return /* @__PURE__ */ y.jsxs("li", { style: { background: F.surface2, border: `1px solid ${F.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }, children: [
    /* @__PURE__ */ y.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ y.jsx("span", { style: Uu(r.kind === "delta"), children: r.kind === "delta" ? e.kindDelta : e.kindText }),
      /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.68rem", color: F.text2 }, children: e.versionTag(r.version) }),
      /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.68rem", color: F.text2 }, children: e.weightTag(r.weight) }),
      s && /* @__PURE__ */ y.jsx("span", { style: yE, children: e.notDistilled }),
      a.state === "distilled" && a.teacherModel && /* @__PURE__ */ y.jsx("span", { style: { fontSize: "0.68rem", color: F.text2 }, children: e.distilledBy(a.teacherModel) }),
      /* @__PURE__ */ y.jsx("span", { style: { marginLeft: "auto", fontSize: "0.68rem", color: F.text2 }, children: e.formatWhen(r.at) })
    ] }),
    r.prompt && /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.76rem", fontWeight: 600, color: F.text, wordBreak: "break-word" }, children: r.prompt }),
    i ? /* @__PURE__ */ y.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }, children: s ? /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.74rem", color: F.text2, lineHeight: 1.5 }, children: e.teacherFault(a.teacherModel ?? "", a.reason) }) : r.text && /* @__PURE__ */ y.jsxs("div", { children: [
      /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.04em", color: F.text2 }, children: e.detailTextLabel }),
      /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.74rem", color: F.text, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "pre-wrap" }, children: r.text })
    ] }) }) : c && /* @__PURE__ */ y.jsx("div", { style: { fontSize: "0.74rem", color: F.text2, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }, children: c }),
    d && /* @__PURE__ */ y.jsx("button", { type: "button", onClick: () => o((p) => !p), style: { ...qu, alignSelf: "flex-start" }, children: i ? e.hideDetail : e.viewDetail })
  ] });
}
var yE = {
  fontSize: "0.6rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "1px 6px",
  borderRadius: 5,
  color: F.warnText,
  background: F.warnBg,
  border: `1px solid ${F.warnBorder}`
}, vE = {
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 999,
  color: F.warnText,
  background: F.warnBg,
  border: `1px solid ${F.warnBorder}`,
  whiteSpace: "nowrap"
}, Xs = {
  fontSize: "0.64rem",
  fontWeight: 600,
  padding: "1px 7px",
  borderRadius: 999,
  border: `1px solid ${F.border}`,
  background: F.surface,
  color: F.text2,
  whiteSpace: "nowrap"
};
function xE(e) {
  var i;
  const r = (i = e == null ? void 0 : e.plan) == null ? void 0 : i.effective;
  return typeof r == "string" && r !== "free";
}
var ih = (e) => JSON.stringify(e);
function kE(e) {
  const { request: r, projectId: i } = e, o = `/api/projects/${i}/evermind`, a = (h, m) => r(`${o}${h}`, { method: "POST", ...m === void 0 ? {} : { body: ih(m) } }), s = (h, m) => r(`${o}${h}`, { method: "PATCH", body: ih(m) }).then(() => {
  }), c = {
    loadData: () => r(`${o}/contributions`),
    loadSeedModels: async () => ((await r("/api/llm/models")).models ?? []).filter((m) => {
      var v;
      return typeof m.slug == "string" && !!((v = m.baseModel) != null && v.startsWith("evermind/"));
    }).map((m) => {
      var v;
      return { slug: m.slug, name: ((v = m.name) == null ? void 0 : v.trim()) || m.slug };
    }),
    loadTeacherOptions: async () => {
      const [h, m] = await Promise.all([
        r("/llm/v1/models"),
        r("/api/consumption").catch(() => null)
      ]);
      return { models: h.codingModels ?? [], isPaid: xE(m) };
    },
    seedFromModel: (h) => a("/seed-from-model", { slug: h }).then(() => {
    }),
    setInference: (h) => s("/inference", { enabled: h }),
    setMode: (h) => s("/mode", { mode: h }),
    setTeacher: (h) => s("/teacher", { model: h }),
    // The POST only means "queued" — the teacher runs later in the coordinator's debounced
    // merge — so hand the console the contribution id and let it poll the status door.
    teach: (h, m) => a("/learn-text", { text: h, ...m ? { prompt: m } : {} }).then((v) => v.contributionId ? { contributionId: v.contributionId } : {}),
    teachStatus: (h) => r(`${o}/contribution/${h}`),
    flush: () => a("/flush").then((h) => ({ merged: h.merged ?? 0, version: h.version ?? 0 })),
    validate: (h) => a("/validate", { prompt: h }),
    loadTargets: () => r(`${o}/targets`).then((h) => h.targets ?? []),
    probe: (h) => a("/probe", h ? { prompt: h } : {}),
    reseed: (h) => a("/reseed", h ? { slug: h } : {}).then((m) => ({ version: m.version ?? 0 })),
    reindex: () => a("/reindex").then((h) => ({ reindexed: h.reindexed ?? 0, skipped: h.skipped ?? 0, version: h.version ?? 0 })),
    cleanup: () => a("/cleanup").then((h) => ({ discarded: h.discarded ?? 0, cachedAnswers: h.cachedAnswers ?? 0 })),
    analyze: () => a("/analyze", {}),
    applyFindings: (h) => a("/analyze", { apply: !0, findings: h })
  };
  e.copyText && (c.copyText = e.copyText);
  const { pickMemory: d, compactMemory: p } = e;
  return d && p && (c.importMemory = async () => {
    const h = await d();
    if (!h || h.entries.length === 0) return null;
    const m = await a("/extract-memories", { entries: h.entries }), v = await p({ files: wE(h, m.absorbed), version: m.version });
    return {
      fileName: h.fileName,
      absorbed: m.absorbed.length,
      skipped: m.skipped.length,
      merged: m.merged,
      version: m.version,
      compacted: v.compacted,
      bytesSaved: v.bytesSaved
    };
  }), c;
}
function wE(e, r) {
  const i = new Set(r), o = /* @__PURE__ */ new Map();
  for (const a of e.entries) {
    if (!i.has(a.key)) continue;
    const s = a.path ?? e.path;
    o.set(s, [...o.get(s) ?? [], a.key]);
  }
  return [...o].map(([a, s]) => ({ path: a, absorbedKeys: s }));
}
async function _E(e) {
  return (await e("/api/ide-projects") ?? []).filter((i) => i.modality === "evermind" || i.modality === "llm");
}
function TE(e, r = {}) {
  const { current: i, resolvedProjectId: o, activeProjectId: a } = r;
  if (i != null && e.some((d) => d.storageProjectId === i)) return i;
  const s = o ?? a, c = e.find((d) => d.storageProjectId === s) ?? e.find((d) => a != null && d.containerProjectId === a) ?? e[0];
  return (c == null ? void 0 : c.storageProjectId) ?? null;
}
var bE = [
  "title",
  "description",
  "loading",
  "managerOnlyHint",
  "statusUnseeded",
  "pickModelLabel",
  "noModels",
  "notSetUp",
  "enableCta",
  "working",
  "versionLabel",
  "contributionsLabel",
  "pendingLabel",
  "lastLearnedLabel",
  "neverLearned",
  "inferenceLabel",
  "inferenceHint",
  "learningLabel",
  "learningHint",
  "on",
  "off",
  "connected",
  "frozen",
  "teacherLabel",
  "teacherHint",
  "teacherNone",
  "teacherPaidOnly",
  "teachTitle",
  "teachHint",
  "teachPromptPlaceholder",
  "teachTextPlaceholder",
  "teachCta",
  "teaching",
  "taught",
  "taughtDropped",
  "taughtStillPending",
  "flushCta",
  "flushing",
  "flushedNone",
  "inspectTitle",
  "inspectEmpty",
  "kindText",
  "kindDelta",
  "deltaEntry",
  "refresh",
  "errorGeneric",
  "importTitle",
  "importHint",
  "importCta",
  "importing",
  "importNothing",
  "quarantinedBadge",
  "targetsTitle",
  "targetsHint",
  "targetsEmpty",
  "targetSelfBadge",
  "targetBuildBadge",
  "targetUnseeded",
  "targetInferenceOn",
  "targetConnected",
  "targetFrozen",
  "testTitle",
  "testHint",
  "testPlaceholder",
  "testRunCta",
  "testReadinessCta",
  "testRunning",
  "testResultPrompt",
  "testServable",
  "testRefused",
  "testEmptyOutput",
  "testVerdictReady",
  "testVerdictNotReady",
  "maintenanceTitle",
  "maintenanceHint",
  "reseedLabel",
  "reseedHint",
  "reseedCta",
  "reseedConfirm",
  "reseedStarterOption",
  "reindexLabel",
  "reindexHint",
  "reindexCta",
  "cleanupLabel",
  "cleanupHint",
  "cleanupCta",
  "cleanupConfirm",
  "analyzeTitle",
  "analyzeHint",
  "analyzeCta",
  "analyzing",
  "analyzeCorrectionLabel",
  "analyzeSelectAll",
  "analyzeSelectNone",
  "analyzeApplying",
  "tabsLabel",
  "tabTeach",
  "tabTest",
  "tabCheck",
  "tabMaintain",
  "diagnosticsTitle",
  "diagnosticsHint",
  "diagnosticsCta",
  "diagnosticsCopied",
  "diagnosticsShow",
  "diagnosticsHide",
  "diagnosticsManualHint"
], Pn = (e, r) => e.replace(/\{(\w+)\}/g, (i, o) => o in r ? String(r[o]) : i);
function SE(e, r = "ev.") {
  const i = (x) => e[`${r}${x}`], o = {};
  for (const x of bE) {
    const E = i(x);
    E != null && (o[x] = E);
  }
  const a = i("statusSeeded");
  a && (o.statusSeeded = (x) => Pn(a, { version: x }));
  const s = i("flushedN");
  s && (o.flushedN = (x, E) => Pn(s, { merged: x, version: E }));
  const c = i("importDone");
  c && (o.importDone = (x, E, L, D) => Pn(c, { absorbed: x, version: E, compacted: L, savedKb: D }));
  const d = i("quarantinedHint");
  d && (o.quarantinedHint = (x) => Pn(d, { reason: x }));
  const p = i("targetSeeded");
  p && (o.targetSeeded = (x) => Pn(p, { version: x }));
  const h = i("targetProjectId");
  h && (o.targetProjectId = (x) => Pn(h, { id: x }));
  const m = i("taughtDistilled");
  m && (o.taughtDistilled = (x, E) => Pn(m, { model: x, version: E }));
  const v = i("taughtSelf");
  v && (o.taughtSelf = (x) => Pn(v, { version: x }));
  const w = i("taughtTeacherFault");
  return w && (o.taughtTeacherFault = (x, E) => Pn(w, { model: x, reason: E })), o;
}
function zl(e, r) {
  return r === "hippocampus" ? e.filter((i) => i.kind === "text") : r === "neocortex" ? e.filter((i) => i.fitted !== !1) : [];
}
const El = (e) => Math.max(0, Math.min(1, e));
function CE(e) {
  const r = !!(e != null && e.seeded), i = r && (e == null ? void 0 : e.mode) === "connected", o = (e == null ? void 0 : e.recent) ?? [], a = zl(o, "neocortex").length, s = zl(o, "hippocampus").length, c = (e == null ? void 0 : e.pending) ?? 0, d = (e == null ? void 0 : e.version) ?? 0, p = r ? 1 : 0.08, h = e == null ? void 0 : e.affect, m = h == null ? void 0 : h.state, v = m ? (m.driveCuriosity + m.driveCaution + m.driveEffort + m.driveSocial) / 4 : 0, w = m ? El(Math.abs(m.valence) * 0.5 + m.arousal) : 0, x = (E, L) => ({ charge: r ? Math.max(L, E) : p, count: 0, active: i });
  return {
    neocortex: { charge: r ? Math.max(0.3, El(a / 12)) : p, count: a, active: i },
    hippocampus: { charge: r ? Math.max(0.3, El((s + c) / 12)) : p, count: s, active: i && (s > 0 || c > 0) },
    personality: { charge: r ? Math.max(0.5, El(d / 8)) : p, count: 0, active: !1 },
    amygdala: x(w, 0.25),
    hypothalamus: x(v, 0.25),
    thalamus: h ? x(h.attentionGain, 0.2) : { charge: p, count: 0, active: i },
    basalGanglia: h ? x(h.exploreBias, 0.2) : { charge: p, count: 0, active: i }
  };
}
const oh = { en: { "ev.title": "Project Evermind", "ev.description": "The self-learning model for this project. It adapts as this project’s agents run — inspect what it has learned and steer its training below.", "ev.buildLabel": "Model", "ev.loadingBuilds": "Loading models…", "ev.noBuilds": "No LLM models yet. Create one in the LLM Studio, then it will appear here.", "ev.ungrouped": "Ungrouped", "ev.loading": "Loading…", "ev.managerOnlyHint": "Only a project manager can change these settings.", "ev.statusSeeded": "Learning · v{version}", "ev.statusUnseeded": "Not set up", "ev.quarantinedBadge": "Quarantined", "ev.quarantinedHint": "This Evermind auto-disabled after producing incoherent output ({reason}). Retrain it past the coherence bar to re-enable inference.", "ev.targetsTitle": "Everminds under this project", "ev.targetsHint": "Every Evermind this project contributes learning to.", "ev.targetsEmpty": "No Everminds resolved for this project yet.", "ev.targetSelfBadge": "This project", "ev.targetBuildBadge": "IDE build", "ev.targetSeeded": "v{version}", "ev.targetUnseeded": "not seeded", "ev.targetInferenceOn": "inference", "ev.targetConnected": "connected", "ev.targetFrozen": "frozen", "ev.targetProjectId": "project #{id}", "ev.pickModelLabel": "Base model", "ev.noModels": "No published Evermind models to start from yet. Train and publish one in Studio first.", "ev.notSetUp": "This project’s Evermind isn’t set up yet. A project manager can enable it.", "ev.noProject": "Select a project in the sidebar to inspect its Evermind.", "ev.enableCta": "Enable", "ev.working": "Working…", "ev.versionLabel": "Version", "ev.contributionsLabel": "Learned", "ev.pendingLabel": "Queued", "ev.lastLearnedLabel": "Last learned", "ev.neverLearned": "Never", "ev.inferenceLabel": "Run on Evermind", "ev.inferenceHint": "When on, this project’s agent runs execute on its own learned model.", "ev.learningLabel": "Learning", "ev.learningHint": "When connected, runs contribute what they learn back into the model.", "ev.on": "On", "ev.off": "Off", "ev.connected": "Connected", "ev.frozen": "Frozen", "ev.teacherLabel": "Teacher model", "ev.teacherHint": "Distil each run through a frontier model (task → ideal answer) instead of raw run text.", "ev.teacherNone": "None (learn from raw runs)", "ev.teacherPaidOnly": "A teacher model is available on paid plans.", "ev.teachTitle": "Teach from a transcript", "ev.teachHint": "Paste a chat transcript or exemplar to contribute it to the model now.", "ev.teachPromptPlaceholder": "Task this answered (optional)…", "ev.teachTextPlaceholder": "Paste the transcript or exemplar text…", "ev.teachCta": "Teach", "ev.teaching": "Teaching…", "ev.taught": "Queued for learning.", "ev.taughtDistilled": "Taught: {model} answered it and the model learned that answer (v{version}).", "ev.taughtSelf": "Taught: learned from your text, with no teacher model (v{version}).", "ev.taughtTeacherFault": "Learned, but the teacher {model} produced nothing ({reason}) — so the model learned your raw text, not an ideal answer.", "ev.taughtDropped": "Not learned: the merge could not use this contribution.", "ev.taughtStillPending": "Still queued — this will merge on the next learning pass.", "ev.flushCta": "Learn now", "ev.flushing": "Learning…", "ev.flushedNone": "Nothing queued to learn yet.", "ev.flushedN": "Merged {merged} contribution(s) into v{version}.", "ev.importTitle": "Import from builderforce-memory", "ev.importHint": "Fold a local memory snapshot or Claude Code memory folder into this model, then compact the absorbed facts to stubs so they stop filling your context.", "ev.importCta": "Import & compact…", "ev.importing": "Importing…", "ev.importDone": "Absorbed {absorbed} memory(ies) into v{version}; compacted {compacted} to stubs (~{savedKb} KB recovered).", "ev.importNothing": "Nothing to import — no learnable facts in that file.", "ev.inspectTitle": "Recently learned", "ev.inspectEmpty": "Nothing learned yet. Runs and teaching will appear here.", "ev.kindText": "Run", "ev.kindDelta": "Delta", "ev.deltaEntry": "Weight delta contributed by an agent run.", "ev.testTitle": "Test bench", "ev.testHint": "Run a prompt through the model and see exactly what it writes, graded the same way a real reply is. This is how you check the model is worth switching on — before anyone chats with it.", "ev.testPlaceholder": "Ask the model something, e.g. “Summarise where this project stands.”", "ev.testRunCta": "Run prompt", "ev.testReadinessCta": "Readiness check", "ev.testRunning": "Generating…", "ev.testResultPrompt": "What the model produced", "ev.testServable": "Usable", "ev.testRefused": "Refused", "ev.testEmptyOutput": "(the model produced nothing)", "ev.testVerdictReady": "This model is coherent enough to serve replies.", "ev.testVerdictNotReady": "This model is not coherent enough to serve replies yet. Teach it more, set a teacher model, or re-seed it below.", "ev.maintenanceTitle": "Maintenance", "ev.maintenanceHint": "Repair and tidy the model when it has gone wrong. None of this deletes your project’s work.", "ev.reseedLabel": "Replace the model", "ev.reseedHint": "Start over from a known-good base, keeping the project. Use this when the model has trained itself into nonsense. Replies stay switched off until it passes a readiness check again.", "ev.reseedCta": "Replace…", "ev.reseedConfirm": "Replace this model’s brain with a fresh base? What it has learned so far will no longer shape its answers. This cannot be undone.", "ev.reseedStarterOption": "Fresh starter base (untrained)", "ev.reindexLabel": "Rebuild recall index", "ev.reindexHint": "Re-file every memory against the current model. Memories are filed when they are learned, so recall drifts as the model changes — rebuild if it starts recalling the wrong things.", "ev.reindexCta": "Rebuild index", "ev.cleanupLabel": "Clean up", "ev.cleanupHint": "Throw away anything queued but not yet learned, and clear cached answers so repeat questions are answered fresh. Learned knowledge is untouched.", "ev.cleanupCta": "Clean up", "ev.cleanupConfirm": "Discard everything queued but not yet learned, and clear cached answers?", "ev.analyzeTitle": "Check what it has learned", "ev.analyzeHint": "Read back everything the model has learned and have a frontier model check it for mistakes, stale facts and nonsense — then fix what is wrong by teaching the corrections.", "ev.analyzeCta": "Check knowledge", "ev.analyzing": "Checking…", "ev.analyzeCorrectionLabel": "Will be replaced with", "ev.analyzeSelectAll": "Select all", "ev.analyzeSelectNone": "Clear selection", "ev.analyzeApplying": "Fixing…", "ev.tabsLabel": "Evermind controls", "ev.tabTeach": "Teach", "ev.tabTest": "Test", "ev.tabCheck": "Check", "ev.tabMaintain": "Maintain", "ev.diagnosticsTitle": "Diagnostics", "ev.diagnosticsHint": "Copy everything on this panel — the model’s state, what it actually produced, what it has learned and any problems found — as text you can paste to support or to an AI assistant.", "ev.diagnosticsCta": "Copy diagnostics", "ev.diagnosticsCopied": "Copied to your clipboard.", "ev.diagnosticsShow": "Show report", "ev.diagnosticsHide": "Hide report", "ev.diagnosticsManualHint": "Copying automatically was blocked here — the report is selected below, press Ctrl/Cmd+C to copy it.", "ev.refresh": "Refresh", "ev.errorGeneric": "Something went wrong. Try again." }, zh: { "ev.title": "项目 Evermind", "ev.description": "本项目的自学习模型。它会随着项目中智能体的运行而不断调整 — 在下方查看它学到了什么，并调整它的训练。", "ev.buildLabel": "模型", "ev.loadingBuilds": "正在加载模型…", "ev.noBuilds": "暂无 LLM 模型。请先在 LLM Studio 中创建一个，它就会出现在这里。", "ev.ungrouped": "未分组", "ev.loading": "加载中…", "ev.managerOnlyHint": "只有项目管理者才能更改这些设置。", "ev.statusSeeded": "学习中 · v{version}", "ev.statusUnseeded": "尚未设置", "ev.quarantinedBadge": "已隔离", "ev.quarantinedHint": "此 Evermind 因输出不连贯（{reason}）而自动停用。请继续训练它，越过连贯性门槛后即可重新启用推理。", "ev.targetsTitle": "此项目下的 Evermind", "ev.targetsHint": "此项目会向其贡献学习成果的所有 Evermind。", "ev.targetsEmpty": "尚未为此项目解析出任何 Evermind。", "ev.targetSelfBadge": "本项目", "ev.targetBuildBadge": "IDE 构建", "ev.targetSeeded": "v{version}", "ev.targetUnseeded": "未初始化", "ev.targetInferenceOn": "推理", "ev.targetConnected": "已连接", "ev.targetFrozen": "已冻结", "ev.targetProjectId": "项目 #{id}", "ev.pickModelLabel": "基础模型", "ev.noModels": "暂无可作为起点的已发布 Evermind 模型。请先在 Studio 中训练并发布一个。", "ev.notSetUp": "此项目的 Evermind 尚未设置。项目管理者可以启用它。", "ev.noProject": "在侧边栏中选择一个项目，以查看它的 Evermind。", "ev.enableCta": "启用", "ev.working": "处理中…", "ev.versionLabel": "版本", "ev.contributionsLabel": "已学习", "ev.pendingLabel": "排队中", "ev.lastLearnedLabel": "最近一次学习", "ev.neverLearned": "从未", "ev.inferenceLabel": "在 Evermind 上运行", "ev.inferenceHint": "开启后，此项目的智能体运行将在它自己学习得到的模型上执行。", "ev.learningLabel": "学习", "ev.learningHint": "连接后，每次运行都会把学到的内容回流到模型中。", "ev.on": "开", "ev.off": "关", "ev.connected": "已连接", "ev.frozen": "已冻结", "ev.teacherLabel": "教师模型", "ev.teacherHint": "通过前沿模型对每次运行进行蒸馏（任务 → 理想答案），而不是使用运行的原始文本。", "ev.teacherNone": "无（从原始运行中学习）", "ev.teacherPaidOnly": "教师模型在付费套餐中可用。", "ev.teachTitle": "从对话记录中教学", "ev.teachHint": "粘贴一段对话记录或范例，立即将其贡献给模型。", "ev.teachPromptPlaceholder": "这段内容所回答的任务（可选）…", "ev.teachTextPlaceholder": "粘贴对话记录或范例文本…", "ev.teachCta": "教学", "ev.teaching": "教学中…", "ev.taught": "已排队等待学习。", "ev.taughtDistilled": "已教学：{model} 作出了回答，模型已学习该答案（v{version}）。", "ev.taughtSelf": "已教学：直接从你的文本中学习，未使用教师模型（v{version}）。", "ev.taughtTeacherFault": "已学习，但教师模型 {model} 没有产生任何输出（{reason}）— 因此模型学到的是你的原始文本，而不是理想答案。", "ev.taughtDropped": "未学习：合并过程无法使用此贡献。", "ev.taughtStillPending": "仍在排队 — 将在下一次学习中合并。", "ev.flushCta": "立即学习", "ev.flushing": "学习中…", "ev.flushedNone": "目前没有排队等待学习的内容。", "ev.flushedN": "已将 {merged} 条贡献合并到 v{version}。", "ev.importTitle": "从 builderforce-memory 导入", "ev.importHint": "把本地记忆快照或 Claude Code 记忆文件夹并入此模型，然后将已吸收的事实压缩为存根，使它们不再占用你的上下文。", "ev.importCta": "导入并压缩…", "ev.importing": "正在导入…", "ev.importDone": "已将 {absorbed} 条记忆吸收到 v{version}；已把 {compacted} 条压缩为存根（约释放 {savedKb} KB）。", "ev.importNothing": "没有可导入的内容 — 该文件中没有可学习的事实。", "ev.inspectTitle": "最近学到的内容", "ev.inspectEmpty": "尚未学到任何内容。运行记录和教学内容会出现在这里。", "ev.kindText": "运行", "ev.kindDelta": "增量", "ev.deltaEntry": "由一次智能体运行贡献的权重增量。", "ev.testTitle": "测试台", "ev.testHint": "让模型跑一遍提示词，看看它究竟写出了什么，评分方式与真实回复完全一致。在任何人与它对话之前，用这种方式确认它值不值得开启。", "ev.testPlaceholder": "问模型一个问题，例如“总结一下这个项目目前的进展。”", "ev.testRunCta": "运行提示词", "ev.testReadinessCta": "就绪检查", "ev.testRunning": "正在生成…", "ev.testResultPrompt": "模型的输出", "ev.testServable": "可用", "ev.testRefused": "已拒答", "ev.testEmptyOutput": "（模型没有产生任何输出）", "ev.testVerdictReady": "此模型的连贯性足以用于提供回复。", "ev.testVerdictNotReady": "此模型的连贯性尚不足以提供回复。请继续教它、设置教师模型，或在下方重新初始化它。", "ev.maintenanceTitle": "维护", "ev.maintenanceHint": "当模型出问题时，对它进行修复和整理。这些操作都不会删除你项目中的工作成果。", "ev.reseedLabel": "替换模型", "ev.reseedHint": "从一个已知良好的基础重新开始，同时保留项目。当模型把自己训练得胡言乱语时使用此项。在它再次通过就绪检查之前，回复功能将保持关闭。", "ev.reseedCta": "替换…", "ev.reseedConfirm": "要用全新的基础替换此模型的大脑吗？它此前学到的内容将不再影响它的回答。此操作无法撤销。", "ev.reseedStarterOption": "全新起始基础（未训练）", "ev.reindexLabel": "重建回忆索引", "ev.reindexHint": "针对当前模型重新归档每一条记忆。记忆是在学习时归档的，因此模型变化后回忆会产生偏移 — 若它开始回忆起错误的内容，就重建索引。", "ev.reindexCta": "重建索引", "ev.cleanupLabel": "清理", "ev.cleanupHint": "丢弃所有已排队但尚未学习的内容，并清空缓存的回答，让重复的问题重新作答。已学到的知识不受影响。", "ev.cleanupCta": "清理", "ev.cleanupConfirm": "要丢弃所有已排队但尚未学习的内容，并清空缓存的回答吗？", "ev.analyzeTitle": "检查它学到了什么", "ev.analyzeHint": "回读模型学到的全部内容，让一个前沿模型检查其中的错误、过时事实和胡言乱语 — 然后把更正教给它，修好有问题的地方。", "ev.analyzeCta": "检查知识", "ev.analyzing": "正在检查…", "ev.analyzeCorrectionLabel": "将被替换为", "ev.analyzeSelectAll": "全选", "ev.analyzeSelectNone": "清除选择", "ev.analyzeApplying": "正在修正…", "ev.tabsLabel": "Evermind 控制项", "ev.tabTeach": "教学", "ev.tabTest": "测试", "ev.tabCheck": "检查", "ev.tabMaintain": "维护", "ev.diagnosticsTitle": "诊断", "ev.diagnosticsHint": "把此面板上的所有内容 — 模型状态、它实际产生的输出、它学到的内容以及发现的问题 — 复制为文本，可粘贴给支持团队或 AI 助手。", "ev.diagnosticsCta": "复制诊断信息", "ev.diagnosticsCopied": "已复制到你的剪贴板。", "ev.diagnosticsShow": "显示报告", "ev.diagnosticsHide": "隐藏报告", "ev.diagnosticsManualHint": "此处的自动复制被阻止 — 报告已在下方选中，按 Ctrl/Cmd+C 即可复制。", "ev.refresh": "刷新", "ev.errorGeneric": "出了点问题。请重试。" }, es: { "ev.title": "Evermind del proyecto", "ev.description": "El modelo autodidacta de este proyecto. Se adapta a medida que se ejecutan los agentes del proyecto: revisa abajo lo que ha aprendido y dirige su entrenamiento.", "ev.buildLabel": "Modelo", "ev.loadingBuilds": "Cargando modelos…", "ev.noBuilds": "Aún no hay modelos LLM. Crea uno en el LLM Studio y aparecerá aquí.", "ev.ungrouped": "Sin agrupar", "ev.loading": "Cargando…", "ev.managerOnlyHint": "Solo un manager de proyecto puede cambiar estos ajustes.", "ev.statusSeeded": "Aprendiendo · v{version}", "ev.statusUnseeded": "Sin configurar", "ev.quarantinedBadge": "En cuarentena", "ev.quarantinedHint": "Este Evermind se desactivó automáticamente tras producir una salida incoherente ({reason}). Vuelve a entrenarlo hasta superar el umbral de coherencia para reactivar la inferencia.", "ev.targetsTitle": "Everminds de este proyecto", "ev.targetsHint": "Todos los Evermind a los que este proyecto aporta aprendizaje.", "ev.targetsEmpty": "Aún no se ha resuelto ningún Evermind para este proyecto.", "ev.targetSelfBadge": "Este proyecto", "ev.targetBuildBadge": "Build del IDE", "ev.targetSeeded": "v{version}", "ev.targetUnseeded": "sin inicializar", "ev.targetInferenceOn": "inferencia", "ev.targetConnected": "conectado", "ev.targetFrozen": "congelado", "ev.targetProjectId": "proyecto n.º {id}", "ev.pickModelLabel": "Modelo base", "ev.noModels": "Todavía no hay modelos Evermind publicados de los que partir. Entrena y publica uno en el Studio primero.", "ev.notSetUp": "El Evermind de este proyecto aún no está configurado. Un manager de proyecto puede activarlo.", "ev.noProject": "Selecciona un proyecto en la barra lateral para inspeccionar su Evermind.", "ev.enableCta": "Activar", "ev.working": "Trabajando…", "ev.versionLabel": "Versión", "ev.contributionsLabel": "Aprendido", "ev.pendingLabel": "En cola", "ev.lastLearnedLabel": "Último aprendizaje", "ev.neverLearned": "Nunca", "ev.inferenceLabel": "Ejecutar en Evermind", "ev.inferenceHint": "Cuando está activado, las ejecuciones de agentes de este proyecto se realizan en su propio modelo aprendido.", "ev.learningLabel": "Aprendizaje", "ev.learningHint": "Cuando está conectado, las ejecuciones devuelven al modelo lo que aprenden.", "ev.on": "Activado", "ev.off": "Desactivado", "ev.connected": "Conectado", "ev.frozen": "Congelado", "ev.teacherLabel": "Modelo maestro", "ev.teacherHint": "Destila cada ejecución a través de un modelo frontier (tarea → respuesta ideal) en lugar del texto bruto de la ejecución.", "ev.teacherNone": "Ninguno (aprender de las ejecuciones en bruto)", "ev.teacherPaidOnly": "El modelo maestro está disponible en los planes de pago.", "ev.teachTitle": "Enseñar a partir de una transcripción", "ev.teachHint": "Pega una transcripción de chat o un ejemplo para aportarlo al modelo ahora.", "ev.teachPromptPlaceholder": "Tarea a la que esto respondía (opcional)…", "ev.teachTextPlaceholder": "Pega la transcripción o el texto de ejemplo…", "ev.teachCta": "Enseñar", "ev.teaching": "Enseñando…", "ev.taught": "En cola para aprender.", "ev.taughtDistilled": "Enseñado: {model} respondió y el modelo aprendió esa respuesta (v{version}).", "ev.taughtSelf": "Enseñado: aprendido de tu texto, sin modelo maestro (v{version}).", "ev.taughtTeacherFault": "Aprendido, pero el maestro {model} no produjo nada ({reason}): el modelo aprendió tu texto en bruto, no una respuesta ideal.", "ev.taughtDropped": "No aprendido: la fusión no pudo usar esta aportación.", "ev.taughtStillPending": "Sigue en cola: se fusionará en la próxima pasada de aprendizaje.", "ev.flushCta": "Aprender ahora", "ev.flushing": "Aprendiendo…", "ev.flushedNone": "Aún no hay nada en cola para aprender.", "ev.flushedN": "Se han fusionado {merged} aportación(es) en v{version}.", "ev.importTitle": "Importar desde builderforce-memory", "ev.importHint": "Integra una instantánea de memoria local o una carpeta de memoria de Claude Code en este modelo y luego compacta los hechos absorbidos a stubs para que dejen de llenar tu contexto.", "ev.importCta": "Importar y compactar…", "ev.importing": "Importando…", "ev.importDone": "Se han absorbido {absorbed} memoria(s) en v{version}; se han compactado {compacted} a stubs (~{savedKb} KB recuperados).", "ev.importNothing": "No hay nada que importar: ese archivo no contiene hechos aprendibles.", "ev.inspectTitle": "Aprendido recientemente", "ev.inspectEmpty": "Todavía no ha aprendido nada. Las ejecuciones y las enseñanzas aparecerán aquí.", "ev.kindText": "Ejecutar", "ev.kindDelta": "Delta", "ev.deltaEntry": "Delta de pesos aportado por una ejecución de agente.", "ev.testTitle": "Banco de pruebas", "ev.testHint": "Pasa un prompt por el modelo y mira exactamente lo que escribe, evaluado igual que una respuesta real. Así compruebas si merece la pena activarlo, antes de que nadie chatee con él.", "ev.testPlaceholder": "Pregúntale algo al modelo, p. ej. «Resume en qué punto está este proyecto».", "ev.testRunCta": "Ejecutar prompt", "ev.testReadinessCta": "Comprobación de preparación", "ev.testRunning": "Generando…", "ev.testResultPrompt": "Lo que produjo el modelo", "ev.testServable": "Utilizable", "ev.testRefused": "Rechazado", "ev.testEmptyOutput": "(el modelo no produjo nada)", "ev.testVerdictReady": "Este modelo es lo bastante coherente para servir respuestas.", "ev.testVerdictNotReady": "Este modelo aún no es lo bastante coherente para servir respuestas. Enséñale más, configura un modelo maestro o reinicialízalo abajo.", "ev.maintenanceTitle": "Mantenimiento", "ev.maintenanceHint": "Repara y ordena el modelo cuando algo haya salido mal. Nada de esto elimina el trabajo de tu proyecto.", "ev.reseedLabel": "Reemplazar el modelo", "ev.reseedHint": "Empieza de nuevo desde una base fiable, conservando el proyecto. Úsalo cuando el modelo se haya entrenado hasta decir disparates. Las respuestas seguirán desactivadas hasta que vuelva a superar una comprobación de preparación.", "ev.reseedCta": "Reemplazar…", "ev.reseedConfirm": "¿Reemplazar el cerebro de este modelo por una base nueva? Lo que ha aprendido hasta ahora dejará de influir en sus respuestas. Esto no se puede deshacer.", "ev.reseedStarterOption": "Base inicial nueva (sin entrenar)", "ev.reindexLabel": "Reconstruir el índice de recuerdo", "ev.reindexHint": "Vuelve a indexar cada memoria con el modelo actual. Las memorias se indexan cuando se aprenden, así que el recuerdo se desvía a medida que el modelo cambia: reconstruye el índice si empieza a recordar cosas equivocadas.", "ev.reindexCta": "Reconstruir índice", "ev.cleanupLabel": "Limpiar", "ev.cleanupHint": "Descarta todo lo que esté en cola pero aún no aprendido y borra las respuestas en caché para que las preguntas repetidas se respondan de nuevo. El conocimiento aprendido no se toca.", "ev.cleanupCta": "Limpiar", "ev.cleanupConfirm": "¿Descartar todo lo que está en cola pero aún no aprendido y borrar las respuestas en caché?", "ev.analyzeTitle": "Comprobar lo que ha aprendido", "ev.analyzeHint": "Relee todo lo que el modelo ha aprendido y deja que un modelo frontier lo revise en busca de errores, datos obsoletos y disparates; después corrige lo que esté mal enseñándole las correcciones.", "ev.analyzeCta": "Comprobar el conocimiento", "ev.analyzing": "Comprobando…", "ev.analyzeCorrectionLabel": "Se reemplazará por", "ev.analyzeSelectAll": "Seleccionar todo", "ev.analyzeSelectNone": "Borrar la selección", "ev.analyzeApplying": "Corrigiendo…", "ev.tabsLabel": "Controles de Evermind", "ev.tabTeach": "Enseñar", "ev.tabTest": "Probar", "ev.tabCheck": "Comprobar", "ev.tabMaintain": "Mantener", "ev.diagnosticsTitle": "Diagnósticos", "ev.diagnosticsHint": "Copia todo lo de este panel (el estado del modelo, lo que produjo realmente, lo que ha aprendido y los problemas detectados) como texto que puedes pegar al soporte o a un asistente de IA.", "ev.diagnosticsCta": "Copiar el diagnóstico", "ev.diagnosticsCopied": "Copiado a tu portapapeles.", "ev.diagnosticsShow": "Mostrar el informe", "ev.diagnosticsHide": "Ocultar el informe", "ev.diagnosticsManualHint": "Aquí se bloqueó la copia automática: el informe está seleccionado abajo, pulsa Ctrl/Cmd+C para copiarlo.", "ev.refresh": "Actualizar", "ev.errorGeneric": "Algo ha salido mal. Inténtalo de nuevo." }, fr: { "ev.title": "Evermind du projet", "ev.description": "Le modèle auto-apprenant de ce projet. Il s’adapte au fil des exécutions des agents du projet — examinez ci-dessous ce qu’il a appris et pilotez son entraînement.", "ev.buildLabel": "Modèle", "ev.loadingBuilds": "Chargement des modèles…", "ev.noBuilds": "Aucun modèle LLM pour l’instant. Créez-en un dans le LLM Studio et il apparaîtra ici.", "ev.ungrouped": "Sans groupe", "ev.loading": "Chargement…", "ev.managerOnlyHint": "Seul un manager de projet peut modifier ces paramètres.", "ev.statusSeeded": "Apprentissage · v{version}", "ev.statusUnseeded": "Non configuré", "ev.quarantinedBadge": "En quarantaine", "ev.quarantinedHint": "Cet Evermind s’est désactivé automatiquement après avoir produit une sortie incohérente ({reason}). Réentraînez-le au-delà du seuil de cohérence pour réactiver l’inférence.", "ev.targetsTitle": "Everminds rattachés à ce projet", "ev.targetsHint": "Tous les Evermind auxquels ce projet contribue par son apprentissage.", "ev.targetsEmpty": "Aucun Evermind n’a encore été résolu pour ce projet.", "ev.targetSelfBadge": "Ce projet", "ev.targetBuildBadge": "Build de l’IDE", "ev.targetSeeded": "v{version}", "ev.targetUnseeded": "non initialisé", "ev.targetInferenceOn": "inférence", "ev.targetConnected": "connecté", "ev.targetFrozen": "gelé", "ev.targetProjectId": "projet n° {id}", "ev.pickModelLabel": "Modèle de base", "ev.noModels": "Aucun modèle Evermind publié ne peut servir de point de départ. Entraînez-en un et publiez-le d’abord dans le Studio.", "ev.notSetUp": "L’Evermind de ce projet n’est pas encore configuré. Un manager de projet peut l’activer.", "ev.noProject": "Sélectionnez un projet dans la barre latérale pour inspecter son Evermind.", "ev.enableCta": "Activer", "ev.working": "En cours…", "ev.versionLabel": "Version", "ev.contributionsLabel": "Appris", "ev.pendingLabel": "En file d’attente", "ev.lastLearnedLabel": "Dernier apprentissage", "ev.neverLearned": "Jamais", "ev.inferenceLabel": "Exécuter sur Evermind", "ev.inferenceHint": "Lorsque cette option est activée, les exécutions d’agents de ce projet s’effectuent sur son propre modèle appris.", "ev.learningLabel": "Apprentissage", "ev.learningHint": "Lorsqu’il est connecté, les exécutions reversent au modèle ce qu’elles apprennent.", "ev.on": "Activé", "ev.off": "Désactivé", "ev.connected": "Connecté", "ev.frozen": "Gelé", "ev.teacherLabel": "Modèle enseignant", "ev.teacherHint": "Distillez chaque exécution via un modèle frontier (tâche → réponse idéale) au lieu du texte brut de l’exécution.", "ev.teacherNone": "Aucun (apprendre des exécutions brutes)", "ev.teacherPaidOnly": "Un modèle enseignant est disponible avec les forfaits payants.", "ev.teachTitle": "Enseigner à partir d’une transcription", "ev.teachHint": "Collez une transcription de conversation ou un exemple pour l’apporter au modèle dès maintenant.", "ev.teachPromptPlaceholder": "Tâche à laquelle cela répondait (facultatif)…", "ev.teachTextPlaceholder": "Collez la transcription ou le texte d’exemple…", "ev.teachCta": "Enseigner", "ev.teaching": "Enseignement…", "ev.taught": "Mis en file d’attente pour l’apprentissage.", "ev.taughtDistilled": "Enseigné : {model} a répondu et le modèle a appris cette réponse (v{version}).", "ev.taughtSelf": "Enseigné : appris à partir de votre texte, sans modèle enseignant (v{version}).", "ev.taughtTeacherFault": "Appris, mais l’enseignant {model} n’a rien produit ({reason}) — le modèle a donc appris votre texte brut, et non une réponse idéale.", "ev.taughtDropped": "Non appris : la fusion n’a pas pu utiliser cette contribution.", "ev.taughtStillPending": "Toujours en file d’attente — cela sera fusionné lors de la prochaine passe d’apprentissage.", "ev.flushCta": "Apprendre maintenant", "ev.flushing": "Apprentissage…", "ev.flushedNone": "Rien n’est encore en file d’attente pour l’apprentissage.", "ev.flushedN": "{merged} contribution(s) fusionnée(s) dans v{version}.", "ev.importTitle": "Importer depuis builderforce-memory", "ev.importHint": "Intégrez un instantané de mémoire local ou un dossier de mémoire Claude Code dans ce modèle, puis compactez les faits absorbés en résumés pour qu’ils cessent de remplir votre contexte.", "ev.importCta": "Importer et compacter…", "ev.importing": "Importation…", "ev.importDone": "{absorbed} mémoire(s) absorbée(s) dans v{version} ; {compacted} compactée(s) en résumés (~{savedKb} Ko récupérés).", "ev.importNothing": "Rien à importer — aucun fait exploitable dans ce fichier.", "ev.inspectTitle": "Appris récemment", "ev.inspectEmpty": "Rien n’a encore été appris. Les exécutions et les enseignements apparaîtront ici.", "ev.kindText": "Exécuter", "ev.kindDelta": "Delta", "ev.deltaEntry": "Delta de poids apporté par une exécution d’agent.", "ev.testTitle": "Banc d’essai", "ev.testHint": "Passez un prompt dans le modèle et voyez exactement ce qu’il écrit, évalué comme une vraie réponse. C’est ainsi que vous vérifiez qu’il vaut la peine de l’activer — avant que quiconque ne discute avec lui.", "ev.testPlaceholder": "Posez une question au modèle, p. ex. « Résumez où en est ce projet. »", "ev.testRunCta": "Exécuter le prompt", "ev.testReadinessCta": "Vérification d’aptitude", "ev.testRunning": "Génération…", "ev.testResultPrompt": "Ce que le modèle a produit", "ev.testServable": "Utilisable", "ev.testRefused": "Refusé", "ev.testEmptyOutput": "(le modèle n’a rien produit)", "ev.testVerdictReady": "Ce modèle est suffisamment cohérent pour servir des réponses.", "ev.testVerdictNotReady": "Ce modèle n’est pas encore assez cohérent pour servir des réponses. Enseignez-lui davantage, définissez un modèle enseignant ou réinitialisez-le ci-dessous.", "ev.maintenanceTitle": "Maintenance", "ev.maintenanceHint": "Réparez et remettez de l’ordre dans le modèle lorsqu’il a déraillé. Rien de tout cela ne supprime le travail de votre projet.", "ev.reseedLabel": "Remplacer le modèle", "ev.reseedHint": "Repartez d’une base fiable, en conservant le projet. Utilisez cette option lorsque le modèle s’est entraîné jusqu’à dire n’importe quoi. Les réponses restent désactivées tant qu’il n’a pas repassé une vérification d’aptitude.", "ev.reseedCta": "Remplacer…", "ev.reseedConfirm": "Remplacer le cerveau de ce modèle par une base neuve ? Ce qu’il a appris jusqu’ici ne façonnera plus ses réponses. Cette action est irréversible.", "ev.reseedStarterOption": "Base de départ neuve (non entraînée)", "ev.reindexLabel": "Reconstruire l’index de rappel", "ev.reindexHint": "Réindexez chaque mémoire par rapport au modèle actuel. Les mémoires sont indexées au moment où elles sont apprises, le rappel dérive donc à mesure que le modèle change — reconstruisez l’index s’il se met à rappeler les mauvaises choses.", "ev.reindexCta": "Reconstruire l’index", "ev.cleanupLabel": "Nettoyer", "ev.cleanupHint": "Supprimez tout ce qui est en file d’attente mais pas encore appris, et videz les réponses mises en cache pour que les questions répétées reçoivent une nouvelle réponse. Les connaissances acquises ne sont pas touchées.", "ev.cleanupCta": "Nettoyer", "ev.cleanupConfirm": "Supprimer tout ce qui est en file d’attente mais pas encore appris et vider les réponses mises en cache ?", "ev.analyzeTitle": "Vérifier ce qu’il a appris", "ev.analyzeHint": "Relisez tout ce que le modèle a appris et faites-le vérifier par un modèle frontier à la recherche d’erreurs, de faits obsolètes et d’incohérences — puis corrigez ce qui ne va pas en lui enseignant les corrections.", "ev.analyzeCta": "Vérifier les connaissances", "ev.analyzing": "Vérification…", "ev.analyzeCorrectionLabel": "Sera remplacé par", "ev.analyzeSelectAll": "Tout sélectionner", "ev.analyzeSelectNone": "Effacer la sélection", "ev.analyzeApplying": "Correction…", "ev.tabsLabel": "Commandes Evermind", "ev.tabTeach": "Enseigner", "ev.tabTest": "Tester", "ev.tabCheck": "Vérifier", "ev.tabMaintain": "Entretenir", "ev.diagnosticsTitle": "Diagnostics", "ev.diagnosticsHint": "Copiez tout ce que contient ce panneau — l’état du modèle, ce qu’il a réellement produit, ce qu’il a appris et les problèmes détectés — sous forme de texte à coller au support ou à un assistant IA.", "ev.diagnosticsCta": "Copier le diagnostic", "ev.diagnosticsCopied": "Copié dans votre presse-papiers.", "ev.diagnosticsShow": "Afficher le rapport", "ev.diagnosticsHide": "Masquer le rapport", "ev.diagnosticsManualHint": "La copie automatique a été bloquée ici — le rapport est sélectionné ci-dessous, appuyez sur Ctrl/Cmd+C pour le copier.", "ev.refresh": "Actualiser", "ev.errorGeneric": "Une erreur s’est produite. Réessayez." }, de: { "ev.title": "Projekt-Evermind", "ev.description": "Das selbstlernende Modell für dieses Projekt. Es passt sich an, während die Agenten dieses Projekts laufen — sieh dir unten an, was es gelernt hat, und steuere sein Training.", "ev.buildLabel": "Modell", "ev.loadingBuilds": "Modelle werden geladen…", "ev.noBuilds": "Noch keine LLM-Modelle. Erstelle eines im LLM Studio, dann erscheint es hier.", "ev.ungrouped": "Ohne Gruppe", "ev.loading": "Wird geladen…", "ev.managerOnlyHint": "Nur ein Projektmanager kann diese Einstellungen ändern.", "ev.statusSeeded": "Lernt · v{version}", "ev.statusUnseeded": "Nicht eingerichtet", "ev.quarantinedBadge": "Unter Quarantäne", "ev.quarantinedHint": "Dieses Evermind hat sich nach unzusammenhängender Ausgabe ({reason}) automatisch deaktiviert. Trainiere es über die Kohärenzschwelle hinaus, um die Inferenz wieder zu aktivieren.", "ev.targetsTitle": "Everminds unter diesem Projekt", "ev.targetsHint": "Jedes Evermind, zu dem dieses Projekt Gelerntes beisteuert.", "ev.targetsEmpty": "Für dieses Projekt wurden noch keine Everminds ermittelt.", "ev.targetSelfBadge": "Dieses Projekt", "ev.targetBuildBadge": "IDE-Build", "ev.targetSeeded": "v{version}", "ev.targetUnseeded": "nicht initialisiert", "ev.targetInferenceOn": "Inferenz", "ev.targetConnected": "verbunden", "ev.targetFrozen": "eingefroren", "ev.targetProjectId": "Projekt #{id}", "ev.pickModelLabel": "Basismodell", "ev.noModels": "Noch keine veröffentlichten Evermind-Modelle als Ausgangspunkt. Trainiere und veröffentliche zuerst eines im Studio.", "ev.notSetUp": "Das Evermind dieses Projekts ist noch nicht eingerichtet. Ein Projektmanager kann es aktivieren.", "ev.noProject": "Wähle in der Seitenleiste ein Projekt aus, um dessen Evermind zu untersuchen.", "ev.enableCta": "Aktivieren", "ev.working": "Arbeitet…", "ev.versionLabel": "Version", "ev.contributionsLabel": "Gelernt", "ev.pendingLabel": "In Warteschlange", "ev.lastLearnedLabel": "Zuletzt gelernt", "ev.neverLearned": "Nie", "ev.inferenceLabel": "Auf Evermind ausführen", "ev.inferenceHint": "Wenn aktiviert, laufen die Agenten-Ausführungen dieses Projekts auf seinem eigenen gelernten Modell.", "ev.learningLabel": "Lernen", "ev.learningHint": "Wenn verbunden, geben Läufe das Gelernte an das Modell zurück.", "ev.on": "Ein", "ev.off": "Aus", "ev.connected": "Verbunden", "ev.frozen": "Eingefroren", "ev.teacherLabel": "Lehrermodell", "ev.teacherHint": "Jeden Lauf über ein Frontier-Modell destillieren (Aufgabe → ideale Antwort) statt über den Rohtext des Laufs.", "ev.teacherNone": "Keines (aus Rohläufen lernen)", "ev.teacherPaidOnly": "Ein Lehrermodell ist in kostenpflichtigen Tarifen verfügbar.", "ev.teachTitle": "Aus einem Transkript lehren", "ev.teachHint": "Füge ein Chat-Transkript oder ein Musterbeispiel ein, um es dem Modell jetzt beizusteuern.", "ev.teachPromptPlaceholder": "Aufgabe, die damit beantwortet wurde (optional)…", "ev.teachTextPlaceholder": "Transkript oder Beispieltext einfügen…", "ev.teachCta": "Lehren", "ev.teaching": "Wird gelehrt…", "ev.taught": "Zum Lernen eingereiht.", "ev.taughtDistilled": "Gelehrt: {model} hat geantwortet und das Modell hat diese Antwort gelernt (v{version}).", "ev.taughtSelf": "Gelehrt: aus deinem Text gelernt, ohne Lehrermodell (v{version}).", "ev.taughtTeacherFault": "Gelernt, aber der Lehrer {model} hat nichts produziert ({reason}) — das Modell hat daher deinen Rohtext gelernt, keine ideale Antwort.", "ev.taughtDropped": "Nicht gelernt: Die Zusammenführung konnte diesen Beitrag nicht verwenden.", "ev.taughtStillPending": "Weiterhin in der Warteschlange — dies wird beim nächsten Lerndurchlauf zusammengeführt.", "ev.flushCta": "Jetzt lernen", "ev.flushing": "Lernt…", "ev.flushedNone": "Noch nichts zum Lernen eingereiht.", "ev.flushedN": "{merged} Beitrag/Beiträge in v{version} zusammengeführt.", "ev.importTitle": "Aus builderforce-memory importieren", "ev.importHint": "Nimm einen lokalen Gedächtnis-Snapshot oder einen Claude-Code-Gedächtnisordner in dieses Modell auf und kürze die übernommenen Fakten anschließend zu Stubs, damit sie deinen Kontext nicht mehr füllen.", "ev.importCta": "Importieren & kompaktieren…", "ev.importing": "Wird importiert…", "ev.importDone": "{absorbed} Erinnerung(en) in v{version} aufgenommen; {compacted} zu Stubs kompaktiert (~{savedKb} KB freigegeben).", "ev.importNothing": "Nichts zu importieren — keine lernbaren Fakten in dieser Datei.", "ev.inspectTitle": "Kürzlich gelernt", "ev.inspectEmpty": "Noch nichts gelernt. Läufe und Lehreinheiten erscheinen hier.", "ev.kindText": "Ausführen", "ev.kindDelta": "Delta", "ev.deltaEntry": "Von einem Agentenlauf beigesteuertes Gewichts-Delta.", "ev.testTitle": "Prüfstand", "ev.testHint": "Schicke einen Prompt durch das Modell und sieh genau, was es schreibt — bewertet wie eine echte Antwort. So prüfst du, ob sich das Einschalten lohnt, bevor jemand damit chattet.", "ev.testPlaceholder": "Frag das Modell etwas, z. B. „Fasse zusammen, wo dieses Projekt steht.“", "ev.testRunCta": "Prompt ausführen", "ev.testReadinessCta": "Bereitschaftsprüfung", "ev.testRunning": "Wird generiert…", "ev.testResultPrompt": "Was das Modell produziert hat", "ev.testServable": "Brauchbar", "ev.testRefused": "Abgelehnt", "ev.testEmptyOutput": "(das Modell hat nichts produziert)", "ev.testVerdictReady": "Dieses Modell ist kohärent genug, um Antworten auszuliefern.", "ev.testVerdictNotReady": "Dieses Modell ist noch nicht kohärent genug, um Antworten auszuliefern. Lehre es mehr, setze ein Lehrermodell ein oder initialisiere es unten neu.", "ev.maintenanceTitle": "Wartung", "ev.maintenanceHint": "Repariere und räume das Modell auf, wenn etwas schiefgelaufen ist. Nichts davon löscht die Arbeit deines Projekts.", "ev.reseedLabel": "Modell ersetzen", "ev.reseedHint": "Beginne von einer bekannt guten Basis neu und behalte das Projekt. Nutze das, wenn sich das Modell in Unsinn hineintrainiert hat. Antworten bleiben deaktiviert, bis es die Bereitschaftsprüfung erneut besteht.", "ev.reseedCta": "Ersetzen…", "ev.reseedConfirm": "Das Gehirn dieses Modells durch eine frische Basis ersetzen? Was es bisher gelernt hat, prägt seine Antworten nicht mehr. Das lässt sich nicht rückgängig machen.", "ev.reseedStarterOption": "Frische Startbasis (untrainiert)", "ev.reindexLabel": "Abrufindex neu aufbauen", "ev.reindexHint": "Ordne jede Erinnerung neu am aktuellen Modell ein. Erinnerungen werden beim Lernen eingeordnet, daher driftet der Abruf mit jeder Modelländerung — bau den Index neu auf, wenn die falschen Dinge abgerufen werden.", "ev.reindexCta": "Index neu aufbauen", "ev.cleanupLabel": "Aufräumen", "ev.cleanupHint": "Verwirf alles, was eingereiht, aber noch nicht gelernt ist, und leere zwischengespeicherte Antworten, damit wiederholte Fragen neu beantwortet werden. Gelerntes Wissen bleibt unangetastet.", "ev.cleanupCta": "Aufräumen", "ev.cleanupConfirm": "Alles verwerfen, was eingereiht, aber noch nicht gelernt ist, und zwischengespeicherte Antworten leeren?", "ev.analyzeTitle": "Prüfen, was es gelernt hat", "ev.analyzeHint": "Lies alles zurück, was das Modell gelernt hat, und lass ein Frontier-Modell auf Fehler, veraltete Fakten und Unsinn prüfen — korrigiere dann das Falsche, indem du die Korrekturen lehrst.", "ev.analyzeCta": "Wissen prüfen", "ev.analyzing": "Wird geprüft…", "ev.analyzeCorrectionLabel": "Wird ersetzt durch", "ev.analyzeSelectAll": "Alle auswählen", "ev.analyzeSelectNone": "Auswahl aufheben", "ev.analyzeApplying": "Wird korrigiert…", "ev.tabsLabel": "Evermind-Steuerung", "ev.tabTeach": "Lehren", "ev.tabTest": "Testen", "ev.tabCheck": "Prüfen", "ev.tabMaintain": "Warten", "ev.diagnosticsTitle": "Diagnosen", "ev.diagnosticsHint": "Kopiere alles aus diesem Panel — den Zustand des Modells, was es tatsächlich produziert hat, was es gelernt hat und alle gefundenen Probleme — als Text, den du dem Support oder einem KI-Assistenten einfügen kannst.", "ev.diagnosticsCta": "Diagnose kopieren", "ev.diagnosticsCopied": "In deine Zwischenablage kopiert.", "ev.diagnosticsShow": "Bericht anzeigen", "ev.diagnosticsHide": "Bericht ausblenden", "ev.diagnosticsManualHint": "Automatisches Kopieren wurde hier blockiert — der Bericht ist unten ausgewählt, drücke Strg/Cmd+C, um ihn zu kopieren.", "ev.refresh": "Aktualisieren", "ev.errorGeneric": "Etwas ist schiefgelaufen. Versuche es erneut." } };
function jE(e, r) {
  const i = kE({ ...r.host, projectId: r.projectId }), o = {
    ...i,
    loadData: async () => {
      var h;
      const p = await i.loadData();
      return (h = r.onData) == null || h.call(r, p), p;
    }
  }, a = { ...Em, ...SE(oh[r.locale] ?? oh.en ?? {}) }, s = Ny.createRoot(e);
  let c = 0;
  const d = () => s.render(
    /* @__PURE__ */ y.jsx(
      lE,
      {
        adapter: o,
        canManage: r.canManage,
        projectName: r.projectName,
        labels: a,
        host: "synapse",
        showRecent: !1,
        refreshSignal: c,
        refreshMs: 2e4
      }
    )
  );
  return d(), {
    refresh: () => {
      c += 1, d();
    },
    unmount: () => s.unmount()
  };
}
function RE(e) {
  const r = e, i = (r == null ? void 0 : r.recent) ?? [];
  return {
    signals: CE(r),
    neocortex: zl(i, "neocortex"),
    hippocampus: zl(i, "hippocampus")
  };
}
export {
  RE as cloudBrain,
  EE as isManagerRole,
  _E as loadEvermindBuilds,
  jE as mountEvermindConsole,
  TE as preferredEvermindBuild
};
