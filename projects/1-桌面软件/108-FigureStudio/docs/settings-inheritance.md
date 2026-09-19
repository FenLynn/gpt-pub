# Settings Inheritance Draft

## 目标

常用时无感，临时修改方便，并且明确“我到底改了哪一层”。

## 继承顺序

~~~text
Factory
→ User
→ Project
→ Template / Preset
→ Figure
→ Axes
→ Series
~~~

越靠后的层级只保存 override。

## UI 行为

属性面板应区分 inherited、overridden 与 invalid/incompatible。

常用动作：

- Reset to inherited；
- Save as user default；
- Save as project default；
- Save as template / preset；
- Apply to selected figures。

临时修改默认只影响当前最小对象，除非用户明确提升作用域。