(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.MiniVue = {}));
})(this, (function (exports) { 'use strict';

  function isObject(val) {
    return val && typeof val === 'object'
  }
    
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  function hasOwn(obj, key) {
    return hasOwnProperty.call(obj, key)
  }

  // 递归遍历 obj
  function traverse(obj, seen = new Set()) {
    // 避免循环引用
    if (seen.has(obj)) return
    seen.add(obj);
    for (let key in obj) {
      if (isObject(obj[key])) {
        traverse(obj[key]);
      } else {
        obj[key];
      }
    }
    return obj
  }

  function isSet(val) {
    return type(val, 'set')
  }

  function isMap(val) {
    return type(val, 'map')
  }

  function isString(val) {
    return type(val, 'string')
  }

  function isFunction(val) {
    return type(val, 'function')
  }

  const toString = Object.prototype.toString;
  function type(val, type) {
    const str = toString.call(val);
    const matched = str.match(/\[object (\w+)\]/);
    if (matched) {
      return matched[1].toLowerCase() === type.toLowerCase()
    }
    return false
  }

  const reactiveMap = new Map();
  function reactive(obj) {
    const existingProxy = reactiveMap.get(obj);
    if (existingProxy) {
      return existingProxy
    }
    const proxy = createReactive(obj);
    reactiveMap.set(obj, proxy);

    return proxy
  }
  function shallowReactive(obj) {
    return createReactive(obj, true)
  }

  function readonly(obj) {
    return createReactive(obj, false, true)
  }

  function shallowReadonly(obj) {
    return createReactive(obj, true, true)
  }

  const arrayInstrumentations = {}
  ;['includes', 'indexOf', 'lastIndexOf'].forEach(method => {
    const originMethod = Array.prototype[method];
    arrayInstrumentations[method] = function (...args) {
      // 这里的 this 指向代理对象，先在代理对象中查找
      let res = originMethod.apply(this, args);
      if (res === false) {
        // res 为 false 说明没找到
        // 通过 this.raw 拿到原始数组，再去重新执行并更新 res
        res = originMethod.apply(this.raw, args);
      }

      return res
    };
  });

  // 一个标记变量，代表是否进行追踪，默认为 true，即允许追踪
  let shouldTrack = true
  ;['push', 'pop', 'shift', 'unshift', 'splice'].forEach(method => {
    const originMethod = Array.prototype[method];
    arrayInstrumentations[method] = function (...args) {
      // 禁止追踪
      shouldTrack = false;
      // 原始方法的默认行为 (this 指向代理对象)
      const res = originMethod.apply(this, args);
      // 允许追踪
      shouldTrack = true;

      return res
    };
  });

  function iterationMethod() {
    const target = this.raw;
    // 获取原始迭代器方法
    const iterator = target[Symbol.iterator]();
    const wrap = val => (isObject(val) ? reactive(val) : val);
    // 建立响应式联系
    track(target, ITERATE_KEY);

    return {
      // 自定义迭代器
      next() {
        // 调用原始迭代器的 next 方法
        const { value, done } = iterator.next();
        return {
          done,
          // 包裹
          value: value ? [wrap(value[0]), wrap(value[1])] : value
        }
      },
      // 实现可迭代协议
      //! 解决 for (const [key,value] of p.entries()) {/**/} 报错：p.entries is not a function or its return value is not iterable
      [Symbol.iterator]() {
        return this
      }
    }
  }

  function valuesIterationMethod() {
    const target = this.raw;
    const wrap = val => (isObject(val) ? reactive(val) : val);
    // 建立响应式
    track(target, ITERATE_KEY);
    // 拿到原始迭代器
    const itr = target.values();

    return {
      // 实现自定义迭代器
      next() {
        // 执行原始迭代器的 next 方法
        const { done, value } = itr.next();
        return {
          done,
          value: wrap(value)
        }
      },
      // 迭代器协议
      [Symbol.iterator]() {
        return this
      }
    }
  }

  function keysIterationMethod() {
    const target = this.raw;
    const wrap = val => (isObject(val) ? reactive(val) : val);
    // track(target, ITERATE_KEY
    // 建立副作用函数 与 MAP_KEY_ITERATE_KEY 之间的响应关联 ( 解决 值更新导致 副作用函数重新执行 )
    track(target, MAP_KEY_ITERATE_KEY);
    const itr = target.keys();

    return {
      next() {
        const { done, value } = itr.next();
        return {
          done,
          value: wrap(value)
        }
      },
      [Symbol.iterator]() {
        return this
      }
    }
  }

  // 重写 Set / Map 的方法
  const mutableInstrumentations = {
    /******** Set ********/
    add(val) {
      // 拿到原始对象 (this 指向代理对象)
      const target = this.raw;
      const hadKey = target.has(val);
      if (hadKey) {
        // 值已经存在
        return target
      } else {
        const res = target.add(val);
        // 手动触发依赖执行，指定操作类型为 ADD
        trigger(target, val, 'ADD');
        return res
      }
    },
    /******** Set | Map ********/
    delete(val) {
      // 拿到原始对象 (this 指向代理对象)
      const target = this.raw;
      const hadKey = target.has(val);
      const res = target.delete(val);
      if (hadKey) {
        // key 存在才触发响应
        // 手动触发依赖执行，指定操作类型为 ADD
        trigger(target, val, 'ADD');
      }
      return res
    },
    /******** Map ********/
    get(key) {
      // 拿到原始对象
      const target = this.raw;
      const hadKey = target.has(key);
      // 收集依赖
      track(target, key);
      if (hadKey) {
        // 如果存在 key，则拿到结果
        // 但是如果得到的结果 res 仍然是可代理的数据，那么需要使用 reactive 包装后的响应式数据
        const res = target.get(key);
        return isObject(res) ? reactive(res) : res
      }
    },
    set(key, val) {
      const target = this.raw;
      const hadKey = target.has(key);
      const oldVal = target.get(key);
      const res = target.set(key, val);
      if (!hadKey) {
        // key 不存在，表示新增操作，需要触发 ADD 操作类型 ( ITERATE_KEY )
        trigger(target, key, 'ADD');
      } else if (oldVal !== val && oldVal === oldVal && val === val) {
        // key 存在，且值变了（排除NaN），则是 SET 类型的操作
        // 触发响应
        trigger(target, key, 'SET');
      }
      return res
    },
    forEach(callback, thisArg) {
      // 如果 val 是对象，则将其转为响应式数据
      const wrap = val => (isObject(val) ? reactive(val) : val);
      const target = this.raw;
      // 与 ITERATE_KEY 建立响应式联系
      // 因为任何 改变对象 size 值的操作 (add / delete) 都需要触发响应
      track(target, ITERATE_KEY);
      // 调用原始对象的 forEach
      target.forEach((value, key) => {
        callback.call(thisArg, wrap(value), key, this);
      });
    },
    // 集合迭代器方法 (Symbol.iterator)
    [Symbol.iterator]: iterationMethod,
    // map[Symbol.iterator] === map.entries 二者等价
    entries: iterationMethod,
    keys: keysIterationMethod,
    values: valuesIterationMethod
  };

  /**
   * 将对象转为响应式对象
   * @param {Object} obj 代理对象
   * @param {Boolean} isShallow 是否浅响应
   * @param {Boolean} isReadonly 是否只读
   * @returns
   */
  function createReactive(obj, isShallow = false, isReadonly = false) {
    const proxy = new Proxy(obj, {
      get(target, prop, receiver) {
        if (prop === 'raw') {
          return target
        }
        if (isSet(target) || isMap(target)) {
          // 如果 target 是 Set 或 Map 类型
          if (prop === 'size') {
            // 收集依赖 建立 ITERATE_KEY 到副作用函数之间的联系
            track(target, ITERATE_KEY);
            // 修正 receiver
            return Reflect.get(target, prop, target)
          }
          if (hasOwn(mutableInstrumentations, prop)) {
            // 强制绑定 this 指向为 target (解决实际执行方法时 this 指向代理对象的问题)
            return mutableInstrumentations[prop]
          }
        }
        // 拦截数组的基本方法
        if (Array.isArray(target) && hasOwn(arrayInstrumentations, prop)) {
          return Reflect.get(arrayInstrumentations, prop, receiver)
        }
        if (!isReadonly && typeof prop !== 'symbol') {
          // 非只读 且 非symbol类型 才建立响应式联系
          track(target, prop);
        }
        const result = Reflect.get(target, prop, receiver);
        if (isShallow) {
          // 浅响应
          return result
        }
        if (isObject(result)) {
          return isReadonly ? readonly(result) : reactive(result)
        }
        return result
      },
      set(target, prop, newVal, receiver) {
        if (isReadonly) {
          console.warn(`prop "${prop}" in ${target} is readonly`);
          return true
        }
        const oldVal = target[prop];
        const type = Array.isArray(target)
          ? Number(prop) < target.length
            ? 'SET'
            : 'ADD'
          : hasOwn(target, prop)
          ? 'SET'
          : 'ADD';
        const res = Reflect.set(target, prop, newVal, receiver);

        if (target === receiver.raw) {
          // 说明 receiver 是 target 的代理对象
          if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
            // 排除 NaN 类型
            trigger(target, prop, type, newVal);
          }
        }
        return res // 一定要有返回值: Boolean 类型
      },
      // 拦截 prop in obj
      has(target, prop) {
        track(target, prop);
        return Reflect.has(target, prop)
      },
      // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/ownKeys
      // 拦截 for ... in | Object.keys | Reflect.ownKeys | ... 扩展符
      ownKeys(target) {
        // 如果目标对象 target 是数组，则使用 length 属性建立响应联系
        track(target, Array.isArray(target) ? 'length' : ITERATE_KEY);
        return Reflect.ownKeys(target)
      },
      deleteProperty(target, prop) {
        if (isReadonly) {
          console.warn(`prop "${prop}" in ${target} is readonly`);
          return true
        }
        const hadKey = hasOwn(target, prop);
        // 执行删除操作
        const res = Reflect.deleteProperty(target, prop);
        if (res && hadKey) {
          // 只有当被删除的属性是对象自己的属性并且成功删除时，才触发更新
          trigger(target, prop, 'DELETE');
        }
        return res
      }
    });
    return proxy
  }

  const ITERATE_KEY = Symbol();
  const MAP_KEY_ITERATE_KEY = Symbol();

  const bucket = new WeakMap();

  // 当前注册（激活）的副作用函数
  let activeEffect;
  //! 副作用函数栈，activeEffect 指向栈顶，保证 activeEffect 始终指向正确的副作用函数
  //! 用来解决 effect 嵌套问题
  const effectStack = [];

  // 用来注册副作用函数
  function effect(fn, options = {}) {
    const effectFn = () => {
      cleanup(effectFn);
      activeEffect = effectFn;
      effectStack.push(effectFn);
      const result = fn();
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1];
      return result
    };
    // activeEffect.deps 用来存储与该副作用函数相关联的依赖集合
    effectFn.deps = [];
    effectFn.options = options;
    if (!options.lazy) {
      // 执行副作用函数
      effectFn();
    }
    return effectFn
  }

  // 在 get 拦截器中调用 track 函数追踪变化
  function track(target, prop) {
    // 如果 当前副作用函数不存在 或 禁止追踪时，直接返回
    if (!activeEffect || !shouldTrack) return
    let depsMap = bucket.get(target);
    if (!depsMap) {
      bucket.set(target, (depsMap = new Map()));
    }
    let deps = depsMap.get(prop);
    if (!deps) {
      depsMap.set(prop, (deps = new Set()));
    }
    deps.add(activeEffect); // 收集副作用函数
    activeEffect.deps.push(deps);
  }

  // 在 set 拦截器中调用 trigger 函数触发变化
  function trigger(target, prop, type, newVal) {
    const depsMap = bucket.get(target);
    if (!depsMap) return
    const effects = depsMap.get(prop);
    //! 解决无限循环问题
    const effectsToRun = new Set();
    effects &&
      effects.forEach(effectFn => {
        //! 用来解决 在副作用函数中执行 proxy.count++ 类似问题，即
        //! 如果 trigger 触发执行的副作用函数和当前正在执行的副作用函数相同，则不触发执行
        if (activeEffect !== effectFn) {
          effectsToRun.add(effectFn);
        }
      });
    // 只有操作类型是 `ADD` | `DELETE` | `SET` 且目标对象是 Map
    // 才触发与 ITERATE_KEY 相关联的副作用函数重新执行
    if (
      type === 'ADD' ||
      type === 'DELETE' ||
      (type === 'SET' && isMap(target))
    ) {
      const iterateEffects = depsMap.get(ITERATE_KEY);
      iterateEffects &&
        iterateEffects.forEach(effectFn => {
          if (activeEffect !== effectFn) {
            effectsToRun.add(effectFn);
          }
        });
    }
    // 如果 操作类型为 `ADD` | 'DELETE' 且 目标对象是 Map 类型，触发 MAP_KEY_ITERATE_KEY 相关联的副作用函数
    // 处理 for (const key of map.keys()) {/*...*/}
    if ((type === 'ADD' || type === 'DELETE') && isMap(target)) {
      const iterateEffects = depsMap.get(MAP_KEY_ITERATE_KEY);
      iterateEffects &&
        iterateEffects.forEach(effectFn => {
          if (activeEffect !== effectFn) {
            effectsToRun.add(effectFn);
          }
        });
    }
    if (type === 'ADD' && Array.isArray(target)) {
      // 如果是新增操作且 target 是数组，说明需要触发 length 属性对应的 副作用函数的执行
      const lengthEffects = depsMap.get('length');
      lengthEffects &&
        lengthEffects.forEach(effectFn => {
          if (activeEffect !== effectFn) {
            effectsToRun.add(effectFn);
          }
        });
    }
    if (Array.isArray(target) && prop === 'length') {
      // 设置数组长度
      depsMap.forEach((effects, key) => {
        // 只有当 key 是数组索引且 key 大于等于新设置的数组长度时才会触发执行
        if (key >= newVal) {
          effects.forEach(effectFn => {
            if (activeEffect !== effectFn) {
              effectsToRun.add(effectFn);
            }
          });
        }
      });
    }
    // 触发依赖更新
    effectsToRun.forEach(effectFn => {
      const options = effectFn.options;
      if (options.scheduler) {
        options.scheduler(effectFn);
      } else {
        effectFn();
      }
    });
  }

  // 清除依赖关系
  function cleanup(effectFn) {
    for (let i = 0; i < effectFn.deps.length; i++) {
      // 依赖集合
      const deps = effectFn.deps[i];
      deps.delete(effectFn);
    }
    // 重置
    effectFn.deps.length = 0;
  }

  function ref(val) {
    // 包裹对象
    const wrapper = {
      value: val
    };
    // 在 wrapper 对象上定义不可枚举属性: __v_isRef
    Object.defineProperty(wrapper, '__v_isRef', {
      value: true
    });
    // 将包裹对象变为响应式数据
    return reactive(wrapper)
  }

  // 抽离重复结构 封装成 toRef 函数
  function toRef(obj, prop) {
    const wrapper = {
      get value() {
        return obj[prop]
      },
      set value(val) {
        obj[prop] = val;
      }
    };
    // 定于不可枚举属性: __v_isRef
    Object.defineProperty(wrapper, '__v_isRef', {
      value: true
    });

    return wrapper
  }
  // 如果响应式数据键非常多，直接调用 toRefs 一次性转换
  function toRefs(obj) {
    const ret = {};
    for (const key in obj) {
      ret[key] = toRef(obj, key);
    }
    return ret
  }

  /**
   * 使用该函数对 toRefs 函数返回的结果进行代理 实现自动脱 ref
   * 在实际的 Vue.js 开发中，组件中的 setup 函数的返回结果会传递给 proxyRefs 进行处理
   * 源码：packages/runtime-core/src/component.ts 795 行
   * @param {Object} obj
   * @returns Proxy
   */
  function proxyRefs(obj) {
    return new Proxy(obj, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        // 自动脱 ref
        return value.__v_isRef ? value.value : value
      },
      set(target, prop, newVal, receiver) {
        const value = target[prop];
        if (value.__v_isRef) {
          value.value = newVal;
          return true
        }
        return Reflect.set(target, prop, newVal, receiver)
      }
    })
  }

  /**
   * 计算属性
   * @param {Function|Object} fn
   * @returns
   */
  function computed(fn) {
    // 缓存上一次计算的值
    let value;
    // 标识是否是脏数据. 如果是脏数据需要重新计算求值，否则从缓存拿
    let dirty = true;
    const getter = typeof fn === 'function' ? fn : fn.get;
    const setter = fn.set;
    let obj;

    const effectFn = effect(getter, {
      // 依赖项发生变化 执行调度函数
      scheduler() {
        if (!dirty) {
          dirty = true;
          // 当计算属性依赖的响应式数据变化时，手动调用 trigger 触发响应 执行副作用函数
          trigger(obj, 'value');
        }
      },
      lazy: true // 懒执行 (副作用函数)
    });

    obj = {
      get value() {
        if (dirty) {
          value = effectFn();
          dirty = false;
        }
        // 当读取 value 时，手动追踪依赖
        track(obj, 'value');
        return value
      },
      set value(newVal) {
        if (typeof setter === 'function') {
          setter(newVal);
        }
      }
    };
    return obj
  }

  /**
   * 观测的响应式数据变化，执行回调
   * @param {Object|Function} source 对象或者getter
   * @param {Function} cb 回调函数
   */
  function watch(source, cb, options = {}) {
    // 定义旧值和新值
    let oldValue, newValue;
    let getter;
    if (typeof source === 'function') {
      getter = source;
    } else {
      // 递归读取对象属性
      getter = () => traverse(source);
    }
    // 存储用户注册的过期回调
    let cleanup;
    function onInvalidate(fn) {
      cleanup = fn;
    }

    // 提取 scheduler 为一个独立的函数
    const job = () => {
      // 执行副作用函数 得到新值
      newValue = effectFn();
      if (cleanup) {
        // 调用过期回调
        cleanup();
      }
      cb(newValue, oldValue, onInvalidate);
      // 更新旧值
      oldValue = newValue;
    };

    const effectFn = effect(getter, {
      // 懒执行
      lazy: true,
      scheduler() {
        // flush: 'pre'(组件更新前) | 'post'(组件更新后) | sync (同步，默认方式)
        if (options.flush === 'post') {
          const p = Promise.resolve();
          p.then(job);
        } else {
          job();
        }
      }
    });

    if (options.immediate) {
      // 表示立即执行回调
      job();
    } else {
      oldValue = effectFn();
    }
  }

  const NodeTypes = {
    // AST
    ROOT: 'Root',
    ELEMENT: 'Element',
    TEXT: 'Text',
    SIMPLE_EXPRESSION: 'Simple_Expression',
    INTERPOLATION: 'Interpolation',
    ATTRIBUTE: 'Attribute',
    DIRECTIVE: 'Directive',
  };

  function createVNodeCall(type, tag, props, children) {
    return {
      type,
      tag,
      props,
      children
    }
  }

  /**
   * 模板解析
   * @param {String} str 模板字符串
   * @returns {Object}
   */
  function parse(str) {
    const context = {
      // 存储模板字符串
      source: str,
      // 前进 num 个字符
      advanceBy(num) {
        context.source = context.source.slice(num);
      },
      advanceSpaces() {
        // 匹配空格
        const match = /^[\t\r\n\f ]+/.exec(context.source);
        if (match) {
          context.advanceBy(match[0].length);
        }
      }
    };
    const nodes = parseChildren(context, []);
    // 根节点
    const root = {
      type: NodeTypes.ROOT,
      children: nodes
    };
    return root
  }

  /**
   * 解析子节点
   * @param {Object} context 上下文
   * @param {Array} ancestors 祖先节点
   */
  function parseChildren(context, ancestors = []) {
    const nodes = [];

    while (!isEnd(context, ancestors)) {
      let node;
      const s = context.source;

      if (s.startsWith('{{')) {
        // 解析插值表达式
        node = parseInterpolation(context);
      } else if (s[0] === '<') {
        if (s[1] === '/') ; else if (/[a-z]/i.test(s[1])) {
          // 解析开始标签
          node = parseElement(context, ancestors);
        }
      }
      if (!node) {
        node = parseText(context);
      }
      nodes.push(node);
    }

    /**
     * 举例:
     * const template = `
     *    <div>
     *      <p>Template</p>
     *    </div>
     * `
     * => ast
     * {
          "type": "Root",
          "children": [
            { "type": "Text", "content": "\n  "},
            {
              "type": "Element",
              "tag": "div",
              "props": [],
              "children": [
                { "type": "Text", "content": "\n    " },
                {
                  "type": "Element",
                  "tag": "p",
                  "props": [],
                  "children": [
                    { "type": "Text", "content": "Template" }
                  ]
                },
                { "type": "Text", "content": "\n  " }
              ]
            },
            { "type": "Text", "content": "\n" }
          ]
        }
     * 
     */

    // whitespace handling strategy
    let removeWhitespace = false; // 标记是否需要移除节点
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === NodeTypes.TEXT) {
        // 如果是文本节点
        if (!/[^\t\r\n\f ]/.test(node.content)) {
          // 匹配 `\t\r\n\f `
          const prev = nodes[i - 1];
          const next = nodes[i + 1];

          if (
            !prev ||
            !next ||
            (prev.type === NodeTypes.ELEMENT &&
              next.type === NodeTypes.ELEMENT &&
              /[\r\n]/.test(node.content))
          ) {
            // 处理第一个 或 最后一个 或 连续多个 或 夹在中间的空白符文本节点

            removeWhitespace = true;
            nodes[i] = null;
          } else {
            node.content = ' ';
          }
        } else {
          // 将多个空格，换行等 替换为一个空字符串
          // 比如: `   abc   ` => ' abc '
          node.content = node.content.replace(/[\t\r\f\n ]+/g, ' ');
        }
      }
    }

    return removeWhitespace ? nodes.filter(Boolean) : nodes;
  }

  /**
   * 解析插值表达式
   * @param {*} context 上下文
   * @returns
   */
  function parseInterpolation(context) {
    const { advanceBy } = context;
    // 移除 {{
    advanceBy(2);
    const closeIndex = context.source.indexOf('}}');
    const rawContent = context.source.slice(0, closeIndex);
    // 去掉前后空格
    const content = rawContent.trim();
    advanceBy(rawContent.length);
    // 移除 }}
    advanceBy(2);

    return {
      type: NodeTypes.INTERPOLATION,
      content: {
        type: NodeTypes.SIMPLE_EXPRESSION,
        content
      }
    }
  }

  /**
   * 解析元素
   * @param {*} context 
   * @param {*} ancestors 
   * @returns 
   */
  function parseElement(context, ancestors) {
    // 解析开始标签
    // <div></div>
    const element = parseTag(context);

    ancestors.push(element);
    element.children = parseChildren(context, ancestors);
    ancestors.pop();

    if (context.source.startsWith(`</${element.tag}`)) {
      // 解析结束标签
      parseTag(context, 'end');
    } else {
      console.error(`缺失结束标签：${element.tag}`);
    }

    return element
  }

  /**
   * 解析标签
   * @param {*} context 
   * @param {*} type 
   * @returns 
   */
  function parseTag(context, type = 'start') {
    const { source, advanceBy, advanceSpaces } = context;
    // <div></div>
    // type=start: ['<div', 'div', index: 0, input: '<div>', groups: undefined]
    const match =
      type === 'start'
        ? /^<([a-z][^\t\r\n\f />]*)/i.exec(source) // 匹配开始标签
        : /^<\/([a-z][^\t\r\n\f />]*)/i.exec(source); // 匹配结束标签
    const tag = match[1];

    // 移除 <div
    advanceBy(match[0].length);
    // 移除多余空格
    advanceSpaces();

    const props = parseAttributes(context);

    // 暂时不处理自闭合标签
    // 移除 >
    advanceBy(1);

    return {
      type: NodeTypes.ELEMENT,
      tag,
      props,
      children: []
    }
  }

  /**
   * 解析标签属性
   * @param {*} context
   * @returns {Array}
   * @example
   *
   * id="foo" class="bar"
   * =>
   * [{ type: 'Attribute', name: 'id', value: 'foo' }, { type: 'Attribute', name: 'class', value: 'bar' }]
   */
  function parseAttributes(context) {
    const { advanceBy, advanceSpaces } = context;
    const props = [];

    // example: id="foo" class="bar"></div>
    while (!context.source.startsWith('>') && !context.source.startsWith('/>')) {
      const match = /([\w:-@]+)=/.exec(context.source);
      // 属性名称
      let name = match[1];
      // 移除 id
      advanceBy(name.length);
      // 移除 =
      advanceBy(1);

      let isStatic = true;
      if (name.startsWith('@')) { // @click -> onClick
        isStatic = false; 
        const eventName = name.slice(1);
        name = 'on' + eventName[0].toUpperCase() + eventName.slice(1);
      }

      let value = '';

      const quote = context.source[0];
      const isQuoted = quote === '"' || quote === "'";
      if (isQuoted) {
        advanceBy(1);
        const endIndex = context.source.indexOf(quote);
        value = context.source.slice(0, endIndex);
        advanceBy(value.length);
        advanceBy(1);
      }
      // 移除空格
      advanceSpaces();

      props.push({
        type: NodeTypes.ATTRIBUTE,
        name,
        value,
        isStatic,
      });
    }

    return props
  }

  /**
   * 解析文本
   * @param {*} context 
   * @returns 
   * @examples
   * 
   * case 1: template</div>
   * case 2: template {{ msg }}</div>
   * ...
   */
  function parseText(context) {
    let endIndex = context.source.length;
    const ltIndex = context.source.indexOf('<');
    const delimiterIndex = context.source.indexOf('{{');

    if (ltIndex > -1 && ltIndex < endIndex) {
      endIndex = ltIndex;
    }
    if (delimiterIndex > -1 && delimiterIndex < endIndex) {
      endIndex = delimiterIndex;
    }

    const content = context.source.slice(0, endIndex);

    context.advanceBy(content.length);

    return {
      type: NodeTypes.TEXT,
      content
    }
  }

  /**
   * 是否解析结束
   * @param {*} context 
   * @param {*} ancestors 
   */
  function isEnd(context, ancestors) {
    if (!context.source) return true
    // 与节点栈内全部的节点比较
    for (let i = ancestors.length - 1; i >= 0; --i) {
      if (context.source.startsWith(`</${ancestors[i].tag}`)) {
        return true
      }
    }
  }

  // console.log('开始解析:')
  // const ast = parse(
  //   `<div id="foo" class="bar"><p>{{ msg }}</p><p>Template</p></div>`
  // )

  // console.dir(ast, { depth: null })

  const TO_DISPLAY_STRING = Symbol(`toDisplayString`);
  const CREATE_ELEMENT_VNODE = Symbol('createElementVNode');

  const helperNameMap = {
    [TO_DISPLAY_STRING]: 'toDisplayString',
    [CREATE_ELEMENT_VNODE]: 'createElementVNode'
  };

  /**
   * 代码生成
   * @param {Object} ast JS AST
   * @returns {String}
   */
  function generate(ast) {
    // 创建上下文
    const context = createCodegenContext();
    genCode(ast.codegenNode, context);

    return {
      ast,
      code: context.code // 渲染函数代码
    }
  }

  /**
   * 以渲染函数为例，生成类似 `function render(...)  { return ... }` 代码字符串
   with(ctx) {...}
   * @param {Object} node JS AST
   * @param {Object} context
   */
   function genCode(node, context) {
    // 工具函数
    const { push, indent, deIndent } = context;
    const fnName = 'render';
    const args = ['_ctx'];
    const signature = args.join(', ');

    // 用于最后将代码字符串转为函数
    // new Function(code)
    push(`return `);
    push(`function ${fnName}(`);

    // 生成函数参数代码字符串
    // genNodeList(node.params, context)
    push(signature);
    push(`) `);
    push(`{`);
    // 缩进
    indent();
    push(`const { h, toDisplayString: _toDisplayString } = MiniVue`);
    indent();
    push(`return `);
    // 为函数体生成代码，这里递归地调用 genNode 函数
    // node.body.forEach(n => genNode(n, context))
    genNode(node, context);
    // 取消缩进
    deIndent();
    push(`}`);
  }

  /**
   * 根据节点类型生成对应代码
   * @param {*} node
   * @param {*} context
   */
  function genNode(node, context) {
    switch (node.type) {
      case NodeTypes.INTERPOLATION:
        genInterpolation(node, context);
        break
      case NodeTypes.SIMPLE_EXPRESSION:
        genExpression(node, context);
        break
      case NodeTypes.ELEMENT:
        genElement(node, context);
        break
      case NodeTypes.TEXT:
        genText(node, context);
        break
    }
  }

  /**
   * 生成调用表达式
   * @param {*} node
   * @param {*} context
   * @example
   *
   * 三个参数依次是：tag props children
   * createElementVNode('div', {}, [])
   */
  function genElement(node, context) {
    const { push, helper } = context;
    const { tag, props, children } = node;
    // push(`${helper(CREATE_ELEMENT_VNODE)}('${tag}', `)
    push(`h('${tag}', `);

    if (props && props.length > 0) {
      genProps(props, context);
    } else {
      push('null, ');
    }
    if (children) {
      genChildren(children, context);
    } else {
      push('null');
    }
    push(`)`);
  }

  // props: [
  //   { type: 'Attribute', name: 'id', value: 'foo' },
  //   { type: 'Attribute', name: 'class', value: 'bar' }
  // ]
  // => { id: 'foo', class: 'bar' }
  //
  function genProps(props, context) {
    const { push } = context;
    if (!props.length) {
      push('{}, ');
      return
    }
    push('{ ');

    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      const key = prop ? prop.name : '';
      const value = prop ? prop.value : prop;
      push(JSON.stringify(key));
      push(': ');
      push(prop.isStatic ? JSON.stringify(value) : value);

      if (i < props.length - 1) {
        push(', ');
      }
    }
    push(' }, ');
  }

  function genChildren(children, context) {
    // 处理子节点长度为 1 且是文本节点的情况
    if (children.length === 1) {
      const type = children[0].type;
      if (type === NodeTypes.TEXT) {
        genText(children[0], context);
      } else if (type === NodeTypes.INTERPOLATION) {
        genInterpolation(children[0], context);
      }
    } else {
      genArrayExpression(children, context);
    }
  }

  function genText(node, context) {
    const { push } = context;
    push(`'${node.content}'`);
  }

  /**
   * @param {*} node
   * @param {*} context
   * @example
   *
   * { type: 'Interpolation', content: { type: 'Expression', content: '_ctx.msg' } }
   * =>
   * _ctx.msg
   */
  function genInterpolation(node, context) {
    const { push, helper } = context;
    push(`${helper(TO_DISPLAY_STRING)}(`);
    genNode(node.content, context);
    push(`)`);
  }

  function genExpression(node, context) {
    context.push(node.content);
  }

  /**
   * 生成数组表达式
   * @param {Object} node
   * @param {Object} context
   */
  function genArrayExpression(node, context) {
    const { push } = context;
    // 追加方括号
    push('[');
    // 为数组元素生成代码
    genNodeList(node, context);
    push(']');
  }

  /**
   * 生成节点列表
   * @param {Array} nodes
   * @param {Object} context
   */
  function genNodeList(nodes, context) {
    const { push } = context;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (isString(node)) {
        push(`'${node}'`);
      } else {
        genNode(node, context);
      }
      // 最后一个参数不需要逗号
      if (i < nodes.length - 1) {
        push(', ');
      }
    }
  }

  function createCodegenContext() {
    const context = {
      code: '',
      helper(key) {
        return `_${helperNameMap[key]}`
      },
      push(code) {
        context.code += code;
      },
      // 当前缩进级别，初始值为0，即没有缩进
      currentIndent: 0,
      // 换行，即在代码字符串后面追加 \n 字符，且换行时应该保留缩进，追加 currentIndent * 2 个字符
      newLine() {
        context.code += '\n' + '  '.repeat(context.currentIndent * 2);
      },
      // 用来缩进，即让 currentIndent 自增后，调用 newLine 函数
      indent() {
        context.currentIndent++;
        context.newLine();
      },
      // 取消缩进，即让 currentIndent 自减后，调用 newLine 函数
      deIndent() {
        context.currentIndent--;
        context.newLine();
      }
    };

    return context
  }

  /**
   * AST 转换
   * @param {Object} root 根节点
   */
  function transform(root, options = {}) {
    // 1. 创建 context
    const context = createTransformContext(root, options);
    // 2. 遍历 ast
    traverseNode(root, context);

    createRootCodegen(root);
  }

  /**
   * 深度优先遍历 AST 节点
   * @param {Object} ast
   */
  function traverseNode(ast, context) {
    context.currentNode = ast;
    // 先序遍历

    const exitFns = [];
    const transforms = context.nodeTransforms;
    for (let i = 0; i < transforms.length; i++) {
      // 执行转换操作
      // 返回待执行的一个回调函数
      const onExit = transforms[i](context.currentNode, context);
      if (onExit) {
        exitFns.push(onExit);
      }
      // 由于转换函数可能移除当前节点，因此需要在转换函数执行之后检查当前节点是否存在，如果不存在，则直接返回
      if (!context.currentNode) return
    }

    const children = context.currentNode.children;
    if (children) {
      children.forEach((child, index) => {
        context.parent = context.currentNode;
        context.childIndex = index;
        traverseNode(child, context);
      });
    }

    let size = exitFns.length;
    // 回调函数反序执行，其本质和后续遍历没啥区别
    // 保证了 先处理子节点 再处理父节点
    while (size--) {
      exitFns[size]();
    }
  }

  /**
   * 创建 transform 上下文
   * @param {*} root 
   * @param {*} options
   * @returns 
   */
  function createTransformContext(
    root,
    { nodeTransforms = [] }
  ) {
    const context = {
      // 当前转换的节点
      currentNode: null,
      // 当前节点在父节点的 children 中的位置索引
      childIndex: 0,
      root,
      // 当前转换节点的父节点
      parent: null,
      // 用于替换节点的函数，接收新节点作为参数
      replaceNode(node) {
        // 替换节点
        context.parent.children[context.childIndex] = node;
        // 更新当前节点
        context.currentNode = node;
      },
      // 移除当前节点
      removeNode() {
        if (context.parent) {
          context.parent.children.splice(context.childIndex, 1);
          // 置空当前节点
          context.currentNode = null;
        }
      },
      // 注册 nodeTransforms 数组 (解耦)
      nodeTransforms,
    };

    return context
  }

  function createRootCodegen(root) {
    const { children } = root;
    if (children.length === 1) { 
      // 单根节点
      const child = children[0];
      if (child.type === NodeTypes.ELEMENT && child.codegenNode) {
        const codegenNode = child.codegenNode;
        root.codegenNode = codegenNode;
      } else {
        root.codegenNode = child;
      }
    } else if (children.length > 1) ; else ;
  }

  // 转换标签节点
  function transformElement(node, context) {
    // 将转换代码编写在退出阶段的回调函数中，
    // 这样可以保证该标签节点的子节点全部被处理完毕、
    return () => {
      if (node.type !== NodeTypes.ELEMENT) {
        return
      }
      const type = node.type;
      const tag = node.tag;
      const props = node.props;
      const children = node.children;

      node.props.forEach(prop => {
        if (!prop.isStatic) {
          prop.value = `_ctx.${prop.value}`;
        }
      });
      node.codegenNode = createVNodeCall(type, tag, props, children);
    }
  }

  function transformExpression(node) {
    if (node.type === NodeTypes.INTERPOLATION) {
      node.content = processExpression(node.content);
    }
  }

  function processExpression(node) {
    node.content = `_ctx.${node.content}`;
    return node
  }

  // 转换文本节点
  function transformText(node) {
    if (node.type !== NodeTypes.TEXT) {
      return
    }
  }

  /**
   * 将模板编译为渲染函数字符串
   * @param {String} template 模板
   * @returns {String} 渲染函数字符串
   */
  function baseCompile(template) {
    // 将模板解析为 AST
    const ast = parse(template);
    // 将模板 AST 转换为 JS AST
    transform(
      ast,
      {
        nodeTransforms: [
          transformElement,
          transformText,
          transformExpression,
        ]
      }
    );
    
    return generate(ast)
  }

  /**
   * 将模板编译为渲染函数
   * @param {String} template 模板
   * @returns
   */
  function compileToFunction(template) {
    const { code } = baseCompile(template);
    const render = new Function(code)();

    return {
      code,
      render,
    }
  }

  /**
   * @param {*} n1 old vnode
   * @param {*} n2 new vnode
   * @returns 
   */
  function patch(n1, n2) {
    // there are lots of assumption and only handle simpler cases

    // patch tag
    if (n1.tag === n2.tag) {
      const el = n2.el = n1.el;
      // patch props
      const oldProps = n1.props || {};
      const nweProps = n2.props || {};
      for (const key in nweProps) {
        const oldValue = oldProps[key];
        const newValue = nweProps[key];
        if (oldValue !== newValue) {
          el.setAttribute(key, newValue);
        }
      }
      // patch children
      const oldChildren = n1.children;
      const newChildren = n2.children;
      if (typeof newChildren === 'string') {
        if (typeof oldChildren === 'string') {
          if (newChildren !== oldChildren) {
            el.textContent = newChildren;
          }
        } else { 
          // oldChildren is a array, but we can just override it
          el.textContent = newChildren;
        }
      } else {
        if (typeof oldChildren === 'string') {
          // discard oldChildren
          el.innerHTML = '';
          // mount newChildren
          newChildren.forEach(child => {
            mount(child, el);
          });
        } else {
          // both old and new is a array

          const commonLength = Math.min(oldChildren.length, newChildren.length);
          for (let i = 0; i < commonLength; i++) {
            patch(oldChildren[i], newChildren[i]);
          }
          if (newChildren.length > oldChildren.length) {
            // to new node, just mount it 
            newChildren.slice(oldChildren.length).forEach(child => {
              mount(child, el);
            });
          } else if (newChildren.length < oldChildren.length) {
            oldChildren.slice(newChildren.length).forEach(child => {
              // unmount old el
              el.removeChild(child.el);
            });
          }
        }
      }
    } else {
      // ... replace
    
      // unmount old dom
      n1.parent.removeChild(n1.el);
      // mount new dom
      mount(n2, n1.parent);
    }

    return n1.el
  }

  function createApp(options = {}) {
    const app = {
      mount(container) {
        if (isString(container)) {
          container = document.querySelector(container);
        }
        const template = container.innerHTML;
        let render;
        if (isFunction(options.render)) { // 用户自定义渲染函数
          render = options.render;
        } else {
          ({ render } = compileToFunction(template));
        }
        const setupFn = options.setup || noop;
        const data = proxyRefs(setupFn());

        let oldVNode;
        const reload = () => {
          const vnode = render(data);
          if (oldVNode) {
            vnode.el = patch(oldVNode, vnode);
          } else {
            container.innerHTML = '';
            _mount(vnode, container);
          }
          oldVNode = vnode;
        };

        effect(() => {
          reload();
        });
      }
    };

    return app
  }

  function _mount(vnode, container) {
    const el = vnode.el = document.createElement(vnode.tag);
    // handle props
    if (vnode.props) {
      for (let key in vnode.props) {
          if (key.startsWith('on')) { // 事件绑定
          const eventName = key.slice(2).toLowerCase();
          el.addEventListener(eventName, vnode.props[key]);
        } else {
          el.setAttribute(key, vnode.props[key]);
        }
      }
    }
    // handle children
    if (vnode.children) {
      if (Array.isArray(vnode.children)) {
        vnode.children.forEach(child => {
          _mount(child, el);
        });
      } else { // text node
        el.textContent = vnode.children;
      }
    }
    container.appendChild(el);
  }

  function h(tag, props, children) {
    return {
      tag,
      props,
      children,
    }
  }

  const toDisplayString = (val) => {
    return String(val)
  };

  exports.baseCompile = baseCompile;
  exports.compileToFunction = compileToFunction;
  exports.computed = computed;
  exports.createApp = createApp;
  exports.effect = effect;
  exports.generate = generate;
  exports.h = h;
  exports.parse = parse;
  exports.proxyRefs = proxyRefs;
  exports.reactive = reactive;
  exports.readonly = readonly;
  exports.ref = ref;
  exports.shallowReactive = shallowReactive;
  exports.shallowReadonly = shallowReadonly;
  exports.toDisplayString = toDisplayString;
  exports.toRef = toRef;
  exports.toRefs = toRefs;
  exports.watch = watch;

}));
//# sourceMappingURL=mini-vue.umd.js.map
