---
theme: seriph
background: https://source.unsplash.com/collection/94734566/1920x1080
class: text-center
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: slide-left
mdc: true
---

# Vue3 响应式系统和编译器初探

by 夏影

<!-- <div class="pt-12">
  <span @click="$slidev.nav.next" class="px-2 py-1 rounded cursor-pointer" hover="bg-white bg-opacity-10">
    Press Space for next page <carbon:arrow-right class="inline"/>
  </span>
</div> -->

---

# 目录

<div grid="~ cols-2 gap-4">

<div>

- 响应式系统
  + 引子: 什么是响应式?
  + 如何实现响应式数据?
  + 副作用函数 effect
  + reactive 非原始值的响应式方案
  + ref 原始值的响应式方案
  + computed 的实现原理
  + watch 的实现原理
  + 响应式丢失问题
  + 自动脱 ref

</div>

<div>

- 编译器
  + 抽象语法树 AST
  + 模板解析 parse
  + 转换器 transform
  + 代码生成 codegen
  + 编译 compile

+ 挂载&更新

+ demo: 计数器 Counter

</div>

</div>

---
layout: center
transition: fade-out
---

# 响应式系统

---
layout: default
---

## 引子: 什么是响应式？

考虑下面的代码:

```js
let a = 1
let b = 2
let sum = a + b

console.log(sum) // 3

a = 2
console.log(sum) // 还是 3
```

可以看到，修改 a 的值，sum 并没有自动发生任何改变，`sum = a + b` 并没有重新执行。

现在我们考虑将它包装成一个函数：

```js
function update() {
  sum = a + b
}
```

---
---

然后我们定义一些新术语:

- `update()`: 产生副作用的函数，简称副作用函数，它会修改 sum 的状态
- `a` 和 `b`: 副作用函数的依赖

同时，假设还存在一个魔术方法 `whenDepsChange`，当依赖 a 和 b 发生变化时，重新执行 update 方法

```js
whenDepsChange(update)
```

完整伪代码如下:

```js
let sum
let a = 1
let b = 2
sum = a + b // 3
console.log(sum) // 3

whenDepsChange(function update() {
  sum = a + b
})
a = 10 // 修改 a 的值, 我们期待会重新执行 update 方法，并且 sum 的值变为 12
```

---
---

当然这一切都是做了一些假设的条件下才成立的，真实的 JavaScript 可没有魔术方法 `whenDepsChange`。

那我们可以使用 JS 语言的特性来实现这个魔术方法吗？

当然，接下来我们来了解下如何实现响应式数据。

---

## 如何实现响应式数据

我们知道，在 ES6(ES2015) 之前，如果想拦截数据的读取和赋值操作，只能使用 `Object.defineProperty()` 将对象属性转换为 getter / setter 的形式，这也是 Vue2 所采用的方式，但是在 ES6+ 中，我们可以使用代理 `Proxy` 来实现对数据的拦截。

[简单了解下 Proxy & Reflect](https://w2xi.github.io/vue3-analysis/prerequisites/proxy-and-reflect.html)

现在我们重新定义一些术语:

- 副作用函数 `effect`，即执行 `effect` 函数会产生副作用
- 响应式数据: 数据发生变化会自动执行副作用函数 `effect`

```js
// 执行 effect 会产生副作用
function effect() {
  document.body.innerText = 'hello vue3'
}
```

---
---

考虑下面的代码：

```js
const data = { text: 'Hello' }
const obj = new Proxy(data, {
  get(target, prop, receiver) {
    return Reflect.get(target, prop, receiver)
  },
  set(target, prop, value, receiver) {
    return Reflect.set(target, prop, value, receiver)
  }
})
function effect() {
  document.body.innerText = obj.text // 读取操作
}
// 执行副作用函数
effect() 
// 赋值操作
obj.text = 'Hello Vue3!'
```

现在问题变成: 当修改 `obj.text` 的值时，如何才能重新执行副作用函数 `effect` ?

---
---

假设有一个`桶`，当读取 `obj.text` 时，把副作用函数 `effect` 放入 `桶` 中；当修改 `obj.text` 时，把 `effect` 从 `桶` 中取出执行

```js {all|2|5|all}
function effect() {
  document.body.innerText = obj.text // 读取操作
}
effect() 
obj.text = 'Hello Vue3!' // 赋值操作
```

<arrow v-click="[1, 2]" x1="330" y1="170" x2="630" y2="280" color="#564" width="3" arrowSize="1" />
<arrow v-click="[2, 3]" x1="230" y1="230" x2="630" y2="280" color="#564" width="3" arrowSize="1" />
<img 
  v-click="[1,3]" 
  src="/public/bucket.excalidraw.png" 
  alt="桶占位" 
  style="margin-left: 600px; height: 300px"
/>

---
---

这就需要我们在拦截器中做处理，现在代码变成这样:

```js {all|6|11|all}
// demo: 01-how-to-build-reactivity-data.html
const bucket = new Set()
const data = { text: 'Hello' } 
const obj = new Proxy(data, {
  get(target, prop, receiver) {
    bucket.add(effect)
    return Reflect.get(target, prop, receiver)
  },
  set(target, prop, value, receiver) {
    const result = Reflect.set(target, prop, value, receiver)
    bucket.forEach(fn => fn())
    return result
  }
})
function effect() {
  document.body.innerText = obj.text
}
effect()
obj.text = 'Hello Vue3!'
```

---
---

但是，现在还有一些问题，比如: 副作用函数 `effect` 的名称是硬编码的，一旦修改就会导致代码不能正常工作，现在我们来修复这一点。

<div grid="~ cols-2 gap-2" m="t-2">

```js {1-8,11-14}
// 储存被注册的副作用函数
let activeEffect
// 用来注册副作用函数
function effect(fn) {
  activeEffect = fn
  // 执行副作用函数
  fn()
}
const obj = new Proxy(data, {
  get(target, prop, receiver) {
    if (activeEffect) {
      // 将副作用函数存储到桶中
      bucket.add(activeEffect)
    }
    // 省略其他代码
  },
  // 省略其他代码
})
```

```js {0|all}
// 测试一下效果:
// demo: 02-how-to-design-reactivity-system.html
effect(() => {
  document.body.innerText = obj.text
})
setTimeout(() => {
  // 2 秒后修改响应式数据
  obj.text = 'Hello Vue3!'
}, 2000)
```

</div>

---
---

解决了硬编码副作用函数名称问题，但是再稍微测试，比如给 `obj` 对象设置一个不存在的属性:

```js
// demo: 03-how-to-design-reactivity-system2.html
effect(() => {
  document.body.innerText = obj.text
  console.log('call effect fn') // 打印了两次
})
setTimeout(() => {
  obj.noExist = '测试不存在的属性'
}, 1000)
```

可以看到，第一次执行副作用函数时，读取 `obj.text`，同时将副作用函数储存到桶中，1秒后设置 `obj.noExist` 的值，会重新执行副作用函数，从而导致了打印两次。

显然，结果并不是我们期望的，产生该问题的根本原因是：我们**没有在副作用函数与被操作的目标字段之间建立明确的关联**。

---
---

观察下面一段代码：

```js
// 注册副作用函数
effect(function effectFn() {
  document.body.innerText = obj.text // 读取 obj.text
})
```

这段代码中存在三个角色：

- 代理对象 obj
- 字段名 text
- 副作用函数 effectFn

如果用 target 表示代理对象的原始对象，key 表示被操作的字段名，effectFn 表示被注册的副作用函数，那么可以建立如下联系：

```
target
    └── key
        └── effectFn
```

---

<div grid="~ cols-2 gap-2" m="t-2">

```js
// 如果有两个副作用函数同时读取同一个对象的属性值:
effect(function effectFn1() {
  obj.text
})
effect(function effectFn2() {
  obj.text
})
// 关系如下:
`
target
    └── text
        └── effectFn1
        └── effectFn2
`
```

```js
// 如果一个副作用函数中读取了读取了同一个对象的两个不同属性
effect(function effectFn1() {
  obj.text1
  obj.text2
})
// 关系如下:
`
target
    └── text1
        └── effectFn1
    └── text2
        └── effectFn1
`
```

```js
// 如果在不同的副作用函数中读取了两个不同对象的不同属性
effect(function effectFn1() {
  obj1.text1
})
effect(function effectFn2() {
  obj2.text2
})
```

```js
// 关系如下:
`
target1
    └── text1
        └── effectFn1
target2
    └── text2
        └── effectFn2
`
```
</div>

---
---

代码实现：

```js
const bucket = new WeakMap()
const obj = new Proxy(data, {
  get(target, prop, receiver) {
    if (!activeEffect) return Reflect.get(target, prop, receiver)
    let depsMap = bucket.get(target)
    if (!depsMap) {
      bucket.set(target, (depsMap = new Map()))
    }
    let deps = depsMap.get(prop)
    if (!deps) {
      depsMap.set(prop, (deps = new Set()))
    }
    deps.add(activeEffect) // 将副作用函数添加到桶中
    return Reflect.get(target, prop, receiver)
  },
  set(target, prop, value, receiver) {
    const result = Reflect.set(target, prop, value, receiver)
    const depsMap = bucket.get(target)
    if (!depsMap) return
    const effects = depsMap.get(prop) // 获取 prop 对应的副作用函数
    effects && effects.forEach(fn => fn()) // 执行副作用函数
    return result
  }
})
```

---

前面的代码中我们使用了 `WeakMap Map Set` 来构建数据结构，如下所示：

```ts
WeakMap<target, Map<key, Set<effectFn>>>
```

<img 
  src="/public/data-structure.excalidraw.png"
  alt="the-structure-of-reactivity-data-and-effect-fn"
/>

---

最后，再将代码封装一下：

```js
const obj = reactive(data)

function reactive(data) {
  return new Proxy(data, {
    get(target, prop, receiver) {
      track(target, prop)
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, newVal, receiver) {
      const result = Reflect.set(target, prop, newVal, receiver)
      trigger(target, prop)
      return result
    }
  })
}
// 追踪依赖
function track(target, prop) {/* ... */}
// 触发依赖
function trigger(target, prop) {/* ... */}
```

demo: `04-design-a-full-reactivity-system.html`

---
---

## 嵌套的 effect 和 effect 栈

effect 是可以发生嵌套的，比如:

```js
effect(function effectFn1() {
  effect(function effectFn2() {/* ... */})
  /* ... */
})
```

上面这段代码中，effectFn1 嵌套了 effectFn2，effectFn1 的执行会导致 effectFn2 的执行。那么在真实的 Vue.js 场景中，什么时候会出现这种情况呢？

实际上，渲染函数就是 effect 中执行的：
```js
const ComponentA = {
  render() {/* ... */}
}
effect(() => {
  // 在effect中执行组件A的渲染函数
  ComponentA.render()
})
```

---

当组件发生嵌套时：

```js
const ComponentB = {
  render() {
    return <ComponentA /> // jsx 写法
  }
}
// 相当于
effect(() => {
  ComponentB.render()
  effect(() => {
    ComponentA.render()
  })
})
```
但是，我们目前的代码是不支持effect嵌套的，用下面的代码测试一下:
```js
const data = {a: 1, b: 2}
effect(function effectFn1() {
  console.log('effectFn1 被执行')
  effect(function effectFn2() {
    console.log('effectFn2 被执行')
    obj.a
  })
  obj.b
})
```

---

我们期望副作用函数和对象属性建立的联系如下:

```js
data
  └── a
      └── effectFn1
  └── b
      └── effectFn2
```

但是，当我们修改 `obj.b` 的值时:
```js
// demo: 05-nested-effect.html
obj.b = 20
```

发现输出如下：

```js
effectFn1 被执行
effectFn2 被执行
effectFn2 被执行
```

显然，这是不符合预期的，修改 `obj.b` 的值并没有执行 effectFn1，而实执行了 effectFn2

---

```js
// 储存被激活的副作用函数
let activeEffect
function effect(fn) {
  activeEffect = fn
  fn()
}
effect(function effectFn1() {
  console.log('effectFn1 被执行')
  effect(function effectFn2() {
    console.log('effectFn2 被执行')
    obj.a
  })
  obj.b
})
```

分析以上代码可知，当发生 effect 嵌套时，**内层副作用函数 effectFn2 的执行会覆盖掉 activeEffect 的值**，并且永远不会恢复到原来的值，这就是问题产生的原因。

那么，应该如何解决这个问题吗 ？

---

我们可以引入一个副作用函数栈 `effectStack`，让当前激活的副作用函数始终指向栈顶，即执行副作用函数时，将副作用函数压根栈中，执行完毕从栈中弹出。

```js
let activeEffect
const effectStack = []

function effect(fn) {
  activeEffect = fn
  effectStack.push(fn)
  fn()
  effectStack.pop()
  // 指向栈顶
  activeEffect = effectStack[effectStack.length - 1]
}
```

demo: `06-nested-effect.html`

---

## 调度执行

可调度性是响应系统非常重要的特性。首先我们需要明确什么是
可调度性。所谓可调度，指的是当 trigger 动作触发副作用函数重新
执行时，有能力决定副作用函数执行的方式等。

先看以下代码:

```js
const data = { foo: 1 }
const obj = reactive(data)
effect(() => {
  console.log(obj.foo)
})
obj.foo++
console.log('结束了')

// 输出如下:
1
2
结束了
```
现在假设我们期望输出的顺序如下:
```js
1
'结束了'
2
```

---

在不调整代码顺序的情况下，如何才能得到我们期望的结果呢？这时就需要响应式系统支持 **调度**。

我们可以为 effect 函数设计一个选项参数 options，允许用户指定调度器：

```js
effect(() => {
  console.log(obj.foo)
}, {
  // 调度器函数，参数 fn 是副作用函数
  schedular(fn) {
    // ...
  }
})
```

调整代码，将 options 挂到副作用函数上，在 trigger 函数中将副作用函数传给调度器函数:

<div grid="~ cols-2 gap-2" m="t-2">

```js {2}
function effect(fn, options = {}) {
  fn.options = options
  activeEffect = fn
  effectStack.push(fn)
  fn()
  effectStack.pop()
  activeEffect = effectStack[effectStack.length - 1]
}
```

```js
function trigger(target, prop) {
  effects.forEach(effectFn => {
    if (effectFn.options.schedular) {
      effectFn.options.schedular(effectFn)
    } else {
      effectFn()
    }
  })
}
```

</div>

---

```js
const data = { foo: 1 }
const obj = reactive(data)
effect(() => {
  console.log(obj.foo)
}, {
  schedular(fn) {
    setTimeout(fn)
  }
})
obj.foo++
console.log('结束了')

// 输出如下:
1
'结束了'
2
```

`demo: 07-schedular.html`

---

## 计算属性 computed 与 lazy

有了前面介绍的内容，接下来我们可以来实现一下计算属性了。

计算属性的特性:
- 惰性求值。只有访问计算属性的值时才会执行计算
- 缓存。第一次求值后会缓存结果，依赖未变更时，会从缓存中拿到数据；变更时会导致重新计算。


首先，既然计算属性是懒执行的，那么传递给 `effect` 的副作用函数不应该立即执行，它的执行时机应该由我们来决定。

<div grid="~ cols-2 gap-4">

```js
effect(
  // 指定 lazy 选项，副作用函数不会立即执行
  () => {
    console.log(obj.foo)
  }, 
  { 
    lazy: true 
  }
)
```

```js
function effect(fn, options = {}) {
  fn.options = options
  activeEffect = fn
  effectStack.push(fn)
  if (!options.lazy) { // 只有非 lazy 的时候，才执行
    fn()
  }
  effectStack.pop()
  activeEffect = effectStack[effectStack.length - 1]
  return fn // 返回副作用函数
}
```
</div>
---

现在通过指定 lazy 选项，我们已经可以自由的选择执行副作用函数的时机，那副作用函数具体应该什么时候执行呢?

<div grid="~ cols-2 gap-4">

```js
const effectFn = effect(
  // getter
  () => obj.a + obj.b, 
  { lazy: true }
)
// getter 的返回值
const value = effectFn()
```

```js
function computed(getter) {
  // 缓存上一次计算的值
  let value
  let dirty = true // 是否是脏数据的标记
  const effectFn = effect(getter, {
      // 懒执行
      lazy: true,
      schedular(fn) { // 依赖变更
        dirty = true
      }
    })
  const obj = { // 访问器属性
    get value() {
      if (dirty) {
        dirty = false
        value = effectFn()
      }
      return value
    }
  }
  return obj
}
```

</div>

---

测试一下代码:

demo: `08-computed.html`

```js
const data = { a: 1, b: 2 }
const obj = reactive(data)
const result = computed(() => obj.a + obj.b)
console.log(result) // 3
```

可以看到，结果和我们预期的一样。

但是，当我们在另一个 effect 中使用计算属性时，它似乎还有点bug:

```js
const result = computed(() => obj.a + obj.b)

effect(() => {
  // 在副作用函数中读取计算属性
  console.log(result.value)
})

obj.a++
```
修改`obj.a`的值，副作用函数并没有重新执行。

--- 

实际上这是发生了 effect 嵌套。内层的 effect，即计算属性 computed，无法影响到外层的 effect。

怎么解决呢 ？我们可以手动将计算计算属性和副作用函数建立关联。

```js
function computed(getter) {
  let value
  let dirty = true
  const effectFn = effect(getter, {
    lazy: true,
    schedular(fn) {
      if (!dirty) {
        dirty = true
        trigger(obj, 'value') // 依赖变更时，手动触发
      }
    }
  })
  const obj = { // 访问器属性
    get value() {
      if (dirty) {
        dirty = false
        value = effectFn()
      }
      track(obj, 'value') // 读取 value 属性时，手动追踪
      return value
    }
  }
}
```

---

测试一下代码:

```js
const data = { a: 1, b: 2 }
const obj = reactive(data)
const result = computed(function effectFn() {
  return obj.a + obj.b
})
effect(() => {
  // 在副作用函数中读取计算属性
  console.log(result.value)
})
obj.a++ // 修改 obj.a 的值，副作用函数会重新执行

// 建立的关联:
`
computed(obj)
  └── value
      └── effectFn
`
```

demo: `09-computed-2.html`

---

## watch 的实现原理

和 computed 计算属性类似，在有了 effect 和 schedular 调度的基础后，就可以实现 watch 了。

`watch`，实际上就是观测一个响应式数据的变化，然后执行相应的回调函数。

第一版：

```js
// demo: 10-watch.html
function watch(source, cb) {
  let getter
  if (typeof source === 'function') {
    getter = source
  }
  effect(getter, {
    schedular() {
      cb()
    }
  })
}
watch(() => obj.a, () => {
  console.log('回调被执行')
})
obj.a = 100 // 修改
```

---

可以看到利用 `schedular` 调度的特性很容易实现 `watch`, 但是目前还有一些问题：
- 只支持 getter (应该还要支持响应式数据对象)
- 执行回调时没有传入新旧值

<div grid="~ cols-2 gap-4">

第二版: (demo: `11-watch-2.html`)

```js
function watch(source, cb) {
  let getter
  if (typeof source === 'function') {
    getter = source
  } else {
    getter = () => traverse(source)
  }
  let oldVal, newVal
  const effectFn = effect(getter, {
    lazy: true,
    schedular() {
      newVal = effectFn()
      cb(newVal, oldVal)
      // 更新旧值
      oldVal = newVal
    }
  })
  oldVal = effectFn()
}
```
</div>

---

## reactive: 非原始值的响应式方案

实际上之前对拦截器代码的封装，我们已经实现了 `reactive`。

```js
function reactive(data) {
  return new Proxy() {/* ... */}
}
```

但是目前还有点缺陷，比如:

```js
// demo: 12-reactive.html
const data = { info: { foo: 'bar' } }
const obj = reactive(data)
effect(() => {
  console.log(obj.info.foo) // 'bar'
})
obj.info.foo = 'aaa'
```

当我们修改 `obj.info.foo` 的值，发现副作用函数并没有重新执行。

---

打印 `obj.info` 的值，发现它只是一个普通对象。

```js
console.log(obj.info) // {foo: 'aaa'}
```

因此，我们需要在 get 拦截器中做些处理:

```js {all|6-8|all}
function reactive(data) {
  return new Proxy({
    get(target, prop, receiver) {
      const result = Reflect.get(target, prop, receiver)
      track(target, prop)
      if (isObject(result)) {
        return reactive(result)
      }
      return result
    }
  })
}
```

--- 

```js
// demo: 13-reactive-2.html
const data = { info: { foo: 'bar' } }
const obj = reactive(data)
effect(() => {
  console.log(obj.info.foo)
})
obj.info.foo = 'aaa'
```

再运行一下代码，发现是符合预期的。

---

## ref: 原始值的响应式方案

对于原始数据类型，`number, string...`，JS 底层没有提供任何拦截的方式，JS 只能拦截对象类型的数据。

因此，对于原始数据，可以将其包装成一个对象:

```js
let a = 1 // 原始数据
const wrapper = {
  value: a
}
const obj = reactive(wrapper) // 使用 reactive 将其转为响应式数据
```
再封装成 ref 函数:
```js
// demo: 14-ref.html
function ref(val) {
  const wrapper = {
    value: val
  }
  return reactive(wrapper)
}
const obj = ref(1)
effect(() => {
  console.log(obj.value)
})
obj.value = 2 // 修改 obj.value 的值
```

当修改 `obj.value` 的值时，会触发副作用函数的重新执行，这是符合预期的。

---

现在有了 `ref` 和 `reactive`，那我们如何区分它们呢? 如下代码所示:

```js
const a = ref(1)
const b = reactive({ value: 1 })
```

为了判断一个数据是不是 `ref`，我们可以为其定义一个属性来标志该值是 `ref`

```js {0|all}
function ref(val) {
  const wrapper = { value: val }
  // 定义不可枚举的属性 __v_isRef
  Object.defineProperty(wrapper, '__v_isRef', {
    value: true
  })
  return reactive(wrapper)
}
```

---

## 响应式丢失问题

考虑下面代码：

```js
const obj = reactive({ foo: 1, bar: 2 })
const newObj = { ...obj }

effect(() => {
  console.log(newObj.foo)
})

newObj.foo = 10
```

修改 `newObj.foo` 的值，副作用函数并没有重新渲染。

这是因为 `...obj` 已经使数据丢失响应式了，`newObj` 目前只是一个普通对象

```js
{ ...obj } => { foo: 1, bar: 2 } // 普通对象
```

---

```js
const newObj = { ...obj }
```

转化为如下形式：

```js
const newObj = {
  foo: {
    get value() {
      return obj.foo
    }
  },
  bar: {
    get value() {
      return obj.bar
    }
  }
}
```
测试一下:
```js
effect(() => {
  console.log(newObj.foo.value)
})
obj.foo = 10 // 修改 foo 的值，副作用函数会重新执行
```

---

将其封装成 `toRef` 函数
```js
function toRef(obj, prop) {
  const wrapper = {
    get value() {
      return obj[prop]
    },
    set value(newVal) {
      obj[prop] = newVal
    }
  }
  Object.defineProperty(wrapper, '__v_isRef', {
    value: true
  })

  return wrapper
}
```

简化一下代码:

```js
const newObj = { 
  foo: toRef(obj, 'foo'), 
  bar: toRef(obj, 'bar') 
}
```

---

封装 `toRefs` 函数:
```js
function toRefs(obj) {
  const result = {}
  for (let key in obj) {
    result[key] = toRef(obj, key)
  }
  return result
}
```

测试一下:

```js
// demo: 15-ref-2.html
const newObj = { ...toRefs(obj) }
effect(() => {
  console.log(newObj.foo.value)
})

obj.foo = 10 // 修改可以触发执行
// or
// newObj.foo.value = 10
```

---

## 自动脱 ref

在 Vue.js 中，有下面代码:

```vue
<template>{{ msg }}</template>

<script>
export default {
  setup() {
    const msg = ref('hello')
    return { msg }
  }
}
</script>
```

可以看到，我们不需要在模板中使用 `{{ msg.value }}` 来获取属性值，而是直接使用了 `{{ msg }}`，我们不禁好奇，这是怎么实现的？

---

我们知道，在 `setup()` 函数中会统一返回所有的响应式数据，那么是不是可以对返回的数据做一个代理，当访问 `ref` 数据时自动脱 ref 呢?

> **自动脱 ref**: 比如，在模板中访问 `{{ msg }}` (ref)，通过代理拦截，判断如果是一个 `ref`，那么就访问 `msg.value`

```js
<script>
export default {
  setup() {
    const obj = reactive({ foo: 1, bar: 2 })
    const msg = ref('hello')

    return proxyRefs({
      msg,
      ...toRefs(obj)
    })
  }
}
<script>
```

接下来，看看 `proxyRefs` 函数是如何实现的。

---

> 前文中，如果使用的是 `ref()` 定义的响应式数据，那么其内部会创建一个 `__v_isRef` 属性，用来标识当前数据是一个 `ref` 类型的数据。

```js
// demo: 16-proxyRefs.html
function proxyRefs(obj) {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      return value.__v_isRef ? value.value : value
    },
    set(target, prop, newVal, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (value.__v_isRef) {
        value.value = newVal
        return true
      }
      return Reflect.set(target, prop, newVal, receiver)
    }
  })
}
```

---
layout: center
transition: fade-out
---

# 编译器初探

---

## 编译流程

首先来看看完整的模板编译流程:

![compile](/public/compile-process.excalidraw.png)

用代码可以这样表示:

```js
const template = `<div><div class="test" :id="dynamicId">Template</div></div>`
const templateAST = parse(template)
const jsAST = transform(templateAST)
const code = generate(jsAST) // 代码字符串
const render = new Function(code) // 渲染函数
```

---

![template-to-render](/public/template-to-render.excalidraw.png)

可以看到，模板编译器的最终目的就是将**模板转换(源代码)成渲染函数(目标代码)**。

---

## 抽象语法树 AST (Abstract Syntax Tree ) 

前面我们已经知道了，模板会被解析器解析成 AST，那么什么是 AST 呢？

摘自[维基百科](https://zh.wikipedia.org/zh-cn/%E6%8A%BD%E8%B1%A1%E8%AA%9E%E6%B3%95%E6%A8%B9):

> 在计算机科学中，抽象语法树（Abstract Syntax Tree，AST），是源代码语法结构的一种抽象表示。它以树状的形式表现编程语言的语法结构，树上的每个节点都表示源代码中的一种结构。

由上定义可知:

+ AST 是一个树状结构
+ AST 表示源代码的语法结构

关于 AST，可以看看 [AST Explorer](https://astexplorer.net/)

那 AST 有什么用呢？

---

在前端领域，AST 其实应用广泛，比如:

+ babel: 典型的转译器，也是根据源代码的 AST 转换成其他代码的 AST，再生成目标代码，如 ES6 转 ES5
+ jsx: 大名鼎鼎的 jsx 语法其实也是需要编译的，并且最终编译完也是很多的 `render` 函数
+ ESlint: ESlint 也需要对源代码的 AST 进行解析处理，分析是否符合规则
+ TypeScript: 天天都在用的 ts 也是需要编译的，由 ts 编译成 js
+ V8: Chrome 的 V8 引擎能直接执行 js，想都不用想，肯定需要编译
+ 语法高亮: 每天都看着五颜六色的代码，也是通过编译实现的
+ 代码提示: 同上
+ 错误检验: 同上
+ ...

更多参考:

- [https://juejin.cn/post/7031908854388490248](https://juejin.cn/post/7031908854388490248)
- [https://juejin.cn/post/6844904035271573511](https://juejin.cn/post/6844904035271573511)

---

了解了什么是 AST 后，我们再来看看 Vue 模板对应的 AST 长什么样子。

假设有如下模板:

```js
const template = `<div class="test"><span>Hello</span></div>`
```

经过解析之后，它对应的 AST 结构如下表示:

```js
const ast = {
  type: 'Root', // 逻辑根节点
  children: [
    type: 'Element',
    tag: 'div',
    props: [{ type: 'Attribute', name: 'class', value: 'test'}]
    children: [
      { 
        type: 'Element',
        tag: 'span',
        children: [ { type: 'Text', content: 'Hello' } ]
      }
    ]
  ]
}
```

---

## 节点类型

<div grid="~ cols-2 gap-2">

<div>

根节点:

```js
{
  type: 'Root',
  children: Array,
}
```
</div>

<div>

元素节点:

```js
{
  type: 'Element',
  tag: String,
  props: Array,
  children:Array,
  ...
}
```
</div>

</div>

<div grid="~ cols-2 gap-2">

<div>

属性节点:

```js
{
  type: 'Attribute',
  name: String,
  value: String,
}
```
</div>

<div>

插值表达式节点:

```js
{
  type: 'Interpolation',
  content: {
    type: 'SimpleExpression',
    content: String,
  },
}
```

</div>

</div>

---

文本节点:

```js
{
  type: 'Text',
  content: String,
}
```

定义节点类型枚举:

```js
const NodeTypes = {
  ROOT: 'Root',
  ELEMENT: 'Element',
  TEXT: 'Text',
  INTERPOLATION: 'Interpolation',
  ATTRIBUTE: 'Attribute',
  SIMPLE_EXPRESSION: 'SimpleExpression',
}
```

--- 

## 模板解析 parse

模板是如何被解析成 AST 的呢？

```js
/**
 * @params {String} str 模板字符串
 */
function parse(str) {
  /* ... */
}
```

解析器的参数是模板字符串，会逐个读取字符串模板的字符，并根据一定的规则提取处有用的信息，并形成一个个节点，最终构成一个 AST。

接下来直接上代码，看看是如何处理模板的。

---

```js
/**
 * 解析模板字符串
 * @param {string} str 模板字符串
 */
function parse(str) {
  const context = {
    // 存储模板字符串
    source: str,
    // 前进 num 个字符
    advanceBy(num) {
      context.source = context.source.slice(num)
    },
    advanceSpaces() {
      // 匹配空格换行符等
      const match = /^[\t\r\n\f ]+/.exec(context.source)
      if (match) {
        context.advanceBy(match[0].length)
      }
    }
  }
  const nodes = parseChildren(context, [])
  const root = { // 根节点
    type: NodeTypes.ROOT,
    children: nodes
  }
  return root
}
```

---

<div grid="~ cols-2 gap-2">

```js
/**
 * 解析子节点
 * @param {*} context 上下文
 * @param {*} ancestors 祖先节点列表
 */
function parseChildren(context, ancestors = []) {
  const nodes = []
  while (!isEnd(context, ancestors)) { // 如果还没有解析到模板的末尾
    let node
    const s = context.source
    if (s.startsWith('{{')) {
      // 解析插值表达式
      node = parseInterpolation(context)
    } else if (s[0] === '<') {
      if (s[1] === '/') {
        // 结束标签
      } else if (/[a-z]/i.test(s[1])) { // 解析开始标签
        node = parseElement(context, ancestors)
      }
    }
    if (!node) { // 解析文本节点
      node = parseText(context)
    }
    nodes.push(node)
  }
  return nodes
}
```

```js
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
```

</div>
---

<div grid="~ cols-2 gap-2">

```js
/**
 * 解析插值表达式
 * @param {*} context 上下文
 * @examples
 * 
 * 模板: {{ msg }}
 */
function parseInterpolation(context) {
  const { advanceBy } = context
  // 移除 {{
  advanceBy(2)
  const closeIndex = context.source.indexOf('}}')
  const rawContent = context.source.slice(0, closeIndex)
  // 去掉前后空格
  const content = rawContent.trim()
  advanceBy(rawContent.length)
  // 移除 }}
  advanceBy(2)

  return {
    type: NodeTypes.INTERPOLATION ,
    content: {
      type: NodeTypes.SIMPLE_EXPRESSION,
      content
    }
  }
}
```

```js
/**
 * 解析文本
 * @param {*} context 
 * @examples
 * case 1: template</div>
 * case 2: template {{ msg }}</div>
 */
function parseText(context) {
  let endIndex = context.source.length
  const ltIndex = context.source.indexOf('<')
  const delimiterIndex = context.source.indexOf('{{')

  if (ltIndex > -1 && ltIndex < endIndex) {
    endIndex = ltIndex
  }
  if (delimiterIndex > -1 && delimiterIndex < endIndex) {
    endIndex = delimiterIndex
  }
  const content = context.source.slice(0, endIndex)

  context.advanceBy(content.length)

  return {
    type: NodeTypes.TEXT,
    content
  }
}
```

</div>

---

<div grid="~ cols-2 gap-2">

```js
/**
 * 解析元素
 * @param {*} context 
 * @param {*} ancestors 
 */
function parseElement(context, ancestors) {
  // 解析开始标签
  // <div></div>
  const element = parseTag(context)

  ancestors.push(element)
  element.children = parseChildren(context, ancestors)
  ancestors.pop()

  if (context.source.startsWith(`</${element.tag}`)) {
    // 解析结束标签
    parseTag(context, 'end')
  } else {
    console.error(`缺失结束标签：${element.tag}`)
  }

  return element
}
```

```js
// 解析标签
function parseTag(context, type = 'start') {
  const { source, advanceBy, advanceSpaces } = context
  // <div></div>
  // type=start: ['<div', 'div', index: 0, input: '<div>', groups: undefined]
  const match =
    type === 'start'
      ? /^<([a-z][^\t\r\n\f />]*)/i.exec(source) // 匹配开始标签
      : /^<\/([a-z][^\t\r\n\f />]*)/i.exec(source) // 匹配结束标签
  const tag = match[1]
  // 移除 <div
  advanceBy(match[0].length)
  // 移除多余空格
  advanceSpaces()
  const props = parseAttributes(context)
  // 暂时不处理自闭合标签
  // 移除 >
  advanceBy(1)

  return {
    type: NodeTypes.ELEMENT,
    tag,
    props,
    children: []
  }
}
```

</div>

---

运行一下代码，看看效果:

```js
// demo: 20-parse-template.html

console.log('开始解析:')
const ast = parse(
  `<div id="foo" class="bar"><p>{{ msg }}</p><p>Template</p></div>`
)

console.log(ast)
console.log(JSON.stringify(ast, null, 2))
```

---

## 转换器 transform

前面已经实现了 解析器(parser) —— 将模板字符串解析为 AST 语法树，接下来需要实现 transform 转换器，进一步处理模板 AST，为后期的代码生成做准备。

做了什么工作:

- 预处理插值
- 生成 codegenNode 节点，用于后续的代码生成
- 生成 patchFlag
- 处理指令
- ...

接下来看看代码实现。

---

主入口函数 `transform`:

```js
/**
 * AST 转换
 * @param {Object} root 根节点
 * @param {Object} options 配置项
 */
export function transform(root, options = {}) {
  // 创建上下文
  const context = createTransformContext(root, options)
  // 遍历 ast
  traverseNode(root, context)
  // 处理根节点
  createRootCodegen(root)
}
```

---

创建上下文

<div grid="~ cols-2 gap-2">

```js
function createTransformContext(
  root,
  { nodeTransforms = [] }
) {
  const context = {
    currentNode: null, // 当前转换的节点
    root, // 根节点
    parent: null, // 当前转换节点的父节点
    nodeTransforms, // 节点转换函数列表
  }

  return context
}
```

```js
// 插拔式的插件预设
{
  nodeTransforms: [
    transformElement,
    transformExpression,
    transformText,
  ]
}
```

</div>

---

```js
// 遍历 AST，执行 transforms
function traverseNode(ast, context) {
  context.currentNode = ast
  const exitFns = [] // 保存退出函数
  const transforms = context.nodeTransforms
  for (let i = 0; i < transforms.length; i++) {
    // 执行转换操作，返回待执行的一个回调函数
    const onExit = transforms[i](context.currentNode, context)
    if (onExit) exitFns.push(onExit)
    // 由于转换函数可能移除当前节点，因此需要在转换函数执行之后检查当前节点是否存在，如果不存在，则直接返回
    if (!context.currentNode) return
  }
  const children = context.currentNode.children
  if (children) {
    children.forEach((child, index) => {
      context.parent = context.currentNode
      traverseNode(child, context)
    })
  }
  let size = exitFns.length
  // 回调函数反序执行，从叶节点往根节点执行
  // 保证了 先处理子节点 再处理父节点
  while (size--) {
    exitFns[size]()
  }
}
```

---

拿到子节点的 `codegenNode`，将其挂载到 `root` 上

```js
function createRootCodegen(root) {
  const { children } = root
  if (children.length === 1) { 
    // 单根节点
    const child = children[0]
    if (child.type === NodeTypes.ELEMENT && child.codegenNode) {
      const codegenNode = child.codegenNode
      root.codegenNode = codegenNode
    } else {
      root.codegenNode = child
    }
  } else if (children.length > 1) {
    // 多根节点
  } else {
    // no children
  }
}
```

---

生成 `codegenNode` 节点:

```js
function transformElement(node, context) {
  // 返回一个退出函数
  return () => {
    if (node.type !== NodeTypes.ELEMENT) return
    const type = node.type
    const tag = node.tag
    const props = node.props
    const children = node.children
    // 简单处理下
    node.props.forEach(prop => {
      if (!prop.isStatic) {
        prop.value = `_ctx.${prop.value}`
      }
    })
    node.codegenNode = {
      type,
      tag,
      props,
      children
    }
    // ... 在源码中这块其实是非常复杂的
  }
}
```

---

处理插值表达式

<div grid="~ cols-2 gap-2">

```js
function transformExpression(node) {
  if (node.type === NodeTypes.INTERPOLATION) {
    node.content = processExpression(node.content)
  }
}

function processExpression(node) {
  node.content = `_ctx.${node.content}`
  return node
}
```

```js

// 模板: {{ msg }}

{
  type: NodeTypes.INTERPOLATION,
  content: {
    type: NodeTypes.SIMPLE_EXPRESSION,
    content: 'msg'
  }
}

// 转换 =>

{
  type: NodeTypes.INTERPOLATION,
  content: {
    type: NodeTypes.SIMPLE_EXPRESSION,
    content: '_ctx.msg'
  }
}
```

</div>

---

## 代码生成 codegen

上文实现了 `transform`，接下来进入 `compile` 最后的 `codegen` 阶段。

### 一些准备工作

`codegen` 阶段会根据 `AST` 生成 `render` 函数的代码字符串，而渲染函数的执行会生成虚拟 DOM。

假设模板如下:

```js
<div>{{ msg }}</div>
```
经过 codegen 代码生成后，会生成如下代码:
```js
`
function render(_ctx) {
  return h('div', null, _toDisplayString(_ctx.msg))
}
`
```

---

我们看到，代码字符串中有 `h` 函数，`h` 函数实际上就是对 `createVNode` 的封装，它们都是用于创建 `VNode` 的。

```js
// packages/runtime-core/src/h.ts

function h(tag, props, children) {
  // 我们这里就简单的返回一个对象，实际源码中会复杂很多
  return {
    tag,
    props,
    children,
  }
}
```

`_toDisplayString` 函数是 `toDisplayString` 的别名，它用于将插值表达式转换为字符串:

```js
// packages/shared/src/toDisplayString.ts

const toDisplayString = (val) => {
  return String(val)
}
```

---

### 代码实现


`codegen` 主入口函数:

```js
// 代码生成
function generate(ast) {
  // 创建上下文
  const context = createCodegenContext()
  // 生成代码
  genCode(ast.codegenNode, context)

  return {
    ast,
    code: context.code // 渲染函数代码字符串
  }
}
```

---

<div grid="~ cols-2 gap-2">

```js
// 创建上下文，用于格式化代码字符串
function createCodegenContext() {
  const context = {
    code: '',
    helper(key) {
      return `_${helperNameMap[key]}`
    },
    push(code) {
      context.code += code
    },
    currentIndent: 0, // 当前缩进级别，初始值为0，即没有缩进
    newLine() { // 换行
      context.code += '\n' + '  '.repeat(context.currentIndent * 2)
    },
    indent() { // 缩进
      context.currentIndent++
      context.newLine()
    },
    deIndent() { // 取消缩进
      context.currentIndent--
      context.newLine()
    }
  }
  return context
}
```

```js
// 生成渲染函数代码字符串
function genCode(node, context) {
  const { push, indent, deIndent } = context
  const fnName = 'render'
  const args = ['_ctx']
  const signature = args.join(', ')

  push(`return `)
  push(`function ${fnName}(`)
  push(signature)
  push(`) `)
  push(`{`)
  // 缩进
  indent()
  push(`const { h, _toDisplayString } = MiniVue`)
  indent()
  push(`return `)
  genNode(node, context)
  // 取消缩进
  deIndent()
  push(`}`)
}
```

</div>

---

<div grid="~ cols-2 gap-2">

```js
// 根据节点类型生成对应代码
function genNode(node, context) {
  switch (node.type) {
    case NodeTypes.INTERPOLATION:
      genInterpolation(node, context)
      break
    case NodeTypes.SIMPLE_EXPRESSION:
      genExpression(node, context)
      break
    case NodeTypes.ELEMENT:
      genElement(node, context)
      break
    case NodeTypes.TEXT:
      genText(node, context)
      break
  }
}
```

```js
/**
  example:
  { 
    type: 'Interpolation', 
    content: { 
      type: 'Expression',
      content: '_ctx.msg',
    } 
  }
  =>
  '_ctx.msg'
*/
function genInterpolation(node, context) {
  const { push, helper } = context
  push(`${helper(TO_DISPLAY_STRING)}(`)
  genNode(node.content, context)
  push(`)`)
}

function genExpression(node, context) {
  context.push(node.content)
}
// { type: 'Text', content: 'hello' } => 'hello'
function genText(node, context) {
  const { push } = context
  push(`'${node.content}'`)
}
```

</div>

---

<div grid="~ cols-2 gap-2">

```js
/**
 * 生成调用表达式
 * @example
 * const node = [
 *   type: 'Element', tag: 'div', props: { id: 'foo' }
 *   children: [ { type: 'Text', content: 'hello' } ]
 * ]
 * => h('div', { id: 'foo' }, 'hello')
 * )
 */
function genElement(node, context) {
  const { push, helper } = context
  const { tag, props, children } = node
  push(`h('${tag}', `)

  if (props) {
    genProps(props, context)
  } else {
    push('null, ')
  }
  if (children) {
    genChildren(children, context)
  } else {
    push('null')
  }
  push(`)`)
}
```

```js
// const props = [
//   { type: 'Attribute', name: 'id', value: 'foo' },
//   { type: 'Attribute', name: 'class', value: 'bar' }
// ]
// => { id: 'foo', class: 'bar' }
//
function genProps(props, context) {
  const { push } = context
  if (!props.length) {
    push('{}, ')
    return
  }
  push('{ ')

  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    const key = prop ? prop.name : ''
    const value = prop ? prop.value : prop
    push(JSON.stringify(key))
    push(': ')
    push(prop.isStatic ? JSON.stringify(value) : value)
    if (i < props.length - 1) {
      push(', ')
    }
  }
  push(' }, ')
}
```

</div>

---

<div grid="~ cols-2 gap-2">

```js
// 处理子节点
function genChildren(children, context) {
  genArrayExpression(children, context)
}

/**
 * 生成数组表达式
 * @example
 * const node = [{ 
 *    type: 'Element', 
 *    tag: 'span', 
 *    children: [
 *      { type: 'Text', text: 'hello' }
 *    ]
 * }]
 * =>
 * [h('span', null, 'hello')
 */
function genArrayExpression(node, context) {
  const { push } = context
  // 追加方括号
  push('[')
  // 为数组元素生成代码
  genNodeList(node, context)
  push(']')
}
```

```js
/**
 * 生成节点列表
 * @param {Array} nodes
 * @param {Object} context
 * @example
 */
function genNodeList(nodes, context) {
  const { push } = context
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (typeof node === 'string') {
      push(`'${node}'`)
    } else {
      genNode(node, context)
    }
    if (i < nodes.length - 1) { // 最后一个参数不需要逗号
      push(', ')
    }
  }
}
```

</div>

---

## compile 实现

有了之前实现的 `parse`，`transform` 和 `codegen`，现在我们将其整合起来，实现一个完整的编译。

<div grid="~ cols-2 gap-2">

```js
/**
 * 将模板编译为渲染函数字符串
 * @param {String} template 模板
 * @returns {String} 渲染函数字符串
 */
function baseCompile(template) {
  const ast = parse(template)
  transform(
    ast,
    {
      nodeTransforms: [
        transformElement,
        transformText,
        transformExpression,
      ]
    }
  )
  
  return generate(ast)
}
```

```js
// demo: 21-compile.html

/**
 * 将模板编译为渲染函数
 * @param {String} template 模板
 * @returns {Function} 渲染函数
 */
function compileToFunction(template) {
  const { code } = baseCompile(template)
  const render = new Function(code)()

  return {
    code,
    render,
  }
}
```

</div>

---

## 关于编译优化

我这里其实没做任何的优化，只是把主体逻辑走通了，让代码可以跑起来，而且还有很多功能都没去实现，比如指令的处理，组件的支持等等。

实际上在编译阶段，Vue3 内部是做了很多优化处理的，比如:

- 动态节点标记 patchFlag，为后续的 diff 做准备
- 静态提升
- 事件缓存
- ...


关于编译优化，可以看看 Vue3 提供的一个模板解析工具大致了解下。

[Vue3 Template Explorer](https://template-explorer.vuejs.org/)

---
layout: center
transition: fade-out
---

# 挂载&更新

---

## 挂载

前面我们实现了 **响应式系统** 和 **编译**(丐中丐版)，已经有能力将模板编译成渲染函数了，现在我们将它们整合起来，同时为了能将代码跑起来，我们还需要稍微简单实现下 **挂载**。

如下图所示:

<img src="/public/mount.excalidraw.png" />

---

对于下面的模板:

```html
<ul class="red">
  <li>Vue</li>
  <li>React</li>
  <li>Angular</li>
</ul>
```

经过编译后，其对应的渲染函数如下:

```js
function render() {
  return h('ul', {
      class: 'red',
      onClick() {
        console.log('click')
      }
    }, 
    [ 
      h('li', null, 'Vue'), 
      h('li', null, 'React'), 
      h('li', null, 'Angular') 
    ]
  )
}
```

---

执行渲染函数:

```js
render()
```

会生成下面的 **虚拟DOM**:

```js
// VNode
{
  tag: 'ul',
  props: {
    class: 'red',
    onClick() {
      console.log('click')
    }
  },
  children: [
    { tag: 'li', children: 'Vue' },
    { tag: 'li', children: 'React' },
    { tag: 'li', children: 'Angular' },
  ]
}
```

---

有了虚拟DOM，现在我们尝试手动将其渲染到页面中去。

<div grid="~ cols-2 gap-2">

```js
// 挂载
function mount(vnode, container) {
  const el = document.createElement(vnode.tag)
  if (vnode.props) {
    for (let key in vnode.props) {
      if (key.startsWith('on')) { // 处理事件绑定
        const eventName = key.slice(2).toLowerCase()
        el.addEventListener(eventName, vnode.props[key])
      } else {
        el.setAttribute(key, vnode.props[key])
      }
    }
  }
  if (Array.isArray(vnode.children)) {
    vnode.children.forEach(child => {
      mount(child, el)
    })
  } else { // text node
    el.textContent = vnode.children
  }
  container.appendChild(el)
}
```

```js
// demo: 22-manually-mount.html

const vnode = render()
console.log('VNode: ', vnode);
mount(vnode, document.body)
```

</div>

---

## 更新

前文中，我们已经实现了**挂载**，现在我们将代码封装一下，并实现**更新**的功能。

<div grid="~ cols-2 gap-2">

```js
// 挂载
let _mount = mount

function mount(vnode, container) {
  // ...
}
```

```js
function createApp(options = {}) {
  const app = {
    mount(container) {
      if (isString(container)) {
        container = document.querySelector(container)
      }
      const template = container.innerHTML
      const { render } = compileToFunction(template)
      const setupFn = options.setup || noop
      const setupResult = setupFn() || {}
      const data = proxyRefs(setupResult)
      const reload = () => {
        const vnode = render(data)
        container.innerHTML = ''
        _mount(vnode, container)
      }
      effect(() => reload())
    }
  }
  return app
}
```

</div>

---

现在代码应该可以跑起来了，并且能够响应式更新。

但是这里的更新目前其实是: 先把 dom 清空，然后再重新挂载的一个过程。

来看一个 demo:

<div grid="~ cols-2 gap-2">

```html
<body>
  <div id="app">
    <div class="demo">
      <button @click="minus">-1</button>
      <span class="count">{{ count }}</span>
      <button @click="plus">+1</button>
    </div>
  </div>
</body>

<script src="./static/mini-vue.umd.js"></script>

<script>
const { ref, effect, proxyRefs, compileToFunction } = MiniVue
</script>
```

```js
// demo: 23-force-update.html

createApp({
  setup() {
    const count = ref(0)
    const plus = () => {
      count.value++
    }
    const minus = () => {
      count.value--
    }
    return {
      count,
      plus,
      minus
    }
  }
}).mount('#app')
```

</div>

---

运行 demo，点击 `+1` 按钮，查看 DevTools 的 Elements，发现每次都是全量更新。

接下来我们来简单优化下，实现一个简单的 `patch` 函数，用来对比新旧节点，只更新需要更新的部分。

如下图所示:

<img src="/public/patch.excalidraw.png" />

---

`patch` 函数的实现如下:

```js
/**
 * @param {*} n1 old vnode
 * @param {*} n2 new vnode
 */
function patch(n1, n2) {
  if (n1.tag === n2.tag) {
    // ...
  } else {
    // ...
  }
}
```

具体代码和demo见: `24-patch.html`

---

现在，我们已经实现了 **挂载** 和 **更新**，整合之前的代码，接下来再来看下 **计数器** demo 的效果。

---

## Counter 计数器

demo: `25-counter.html`

> 打开 DevTools 的 Elements 查看效果


<div grid="~ cols-2 gap-2">

```html
<script src="./static/mini-vue.umd.js"></script>
<div id="app">
  <div class="demo">
    <button @click="minus">-1</button>
    <span class="count">{{ count }}</span>
    <button @click="plus">+1</button>
  </div>
</div>
```

```html
<script>
const { createApp, ref } = MiniVue

createApp({
  setup() {
    const count = ref(0)
    const plus = () => {
      count.value++
    }
    const minus = () => {
      count.value--
    }
    return {
      count,
      plus,
      minus
    }
  }
}).mount('#app')
<script>
```

</div>

---

## 手写 render 函数

我们知道，Vue.js 支持 `render` 渲染函数选项，相比较模板，这种方式更加灵活，现在我们也来支持下。

```js
function createApp(options = {}) {
  const app = {
    mount(container) {
      // ...
      let render
      if (isFunction(options.render)) { // 传入 render 函数
        render = options.render
      } else {
        ({ render } = compileToFunction(template))
      }
      // ...
      const reload = () => {
        const vnode = render(data)
        // ...
      }
      effect(() => reload())
    }
  }
  return app
}
```

---

支持了 `render` 渲染函数选项，现在我们使用 `render` 来重写下前面的 Counter 计数器 demo:

<div grid="~ cols-2 gap-2">

```html
<script src="./static/mini-vue.umd.js"></script>
<div id="app"></div>
```

```js
// demo: 26-render-function-options.html

const { createApp, ref, h } = MiniVue
createApp({
  setup() {
    const count = ref(0)
    const plus = () => count.value++
    const minus = () => count.value--
    return {
      count,
      plus,
      minus
    }
  },
  render(props) {
    const { count, plus, minus } = props
    return h('div', { class: 'demo'}, [
      h('button', { onClick: minus }, '-1'),
      h('span', { class: 'count' }, count),
      h('button', { onClick: plus }, '+1')
    ])
  }
}).mount('#app')
```

</div>

---

## 总结

我们依次实现了 响应式系统和模板编译，然后结合这两者实现了简单的挂载和更新。

有了这些基础，我们就可以做一些有趣的事情了。比如写一个计数器的demo，它能做到响应式更新，而且只更新需要更新的部分。

到这里，可以说我们实现了一个乞丐版 `Vue`，不过它只能处理相对简单的场景，但是对理解 Vue3 内部的原理还是非常有帮助的。

---
layout: image
image: /mikoto-misaka.jpg
---

<style>
.thanks {
  position: absolute;
  top: 50%;
  writing-mode: vertical-rl;
  transform: translateY(-50%);
  letter-spacing: 0.3em;
}
</style>

<h1 class="thanks">感谢观看</h1>