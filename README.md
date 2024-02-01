# Vue3 响应式系统和编译器初探

## 前言

这里实现了一个非常简陋的丐版 [mini-vue3](https://github.com/w2xi/mini-vue3)。

依次实现了响应式系统，模板编译器，挂载和更新，最后再以一个 计数器 demo 收尾。

虽然还有蛮多功能没有实现，但是主体逻辑都已经走通了，代码是可以跑起来的 :rocket:，我想这对我们理解 Vue3 背后的工作原理还是挺有帮助的。

## PPT 目录

- 响应式系统
    - [x] 副作用函数 effect
    - [x] reactive
    - [x] ref
    - [x] computed 的实现原理
    - [x] watch 的实现原理
    - [x] 自动脱 ref
- 编译器
    - [x] 抽象语法树 AST 介绍
    - [x] 模板解析 parse
    - [x] 转换器 transform
    - [x] 代码生成 codegen
    - [x] 编译 compile
- 挂载
- 更新 (简单的 patch diff)
- Demo
    - [x] 计数器

## 安装 & 运行

```bash
git clone https://github.com/w2xi/vue3-slides.git

cd vue3-slides

pnpm install

pnpm dev
```
    
## 参考

- 《Vue.js 设计与实现》by 霍春阳
- https://github.com/vuejs/core
- https://github.com/cuixiaorui/mini-vue
- https://github.com/tim101010101/beggar-vue
