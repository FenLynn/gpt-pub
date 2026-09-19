# Architecture v0.1

## 总体结构

~~~text
Project
├─ Folder
├─ Dataset
│  ├─ Column
│  └─ Source
├─ Figure
│  └─ Panel[]
│     └─ Axes[]
│        └─ Series[]
│           └─ Transform[]
├─ Template
├─ Preset
└─ Settings
~~~

v0.1 UI 可以只支持单 Panel / 单 Axes，但模型不得写死。

## 层级职责

- **Project**：保存对象身份、树结构、设置、依赖和资源索引。
- **Dataset**：保存或链接原始数据；一份 Dataset 可以被多张 Figure 引用。
- **Figure**：保存可编辑图形状态，不复制数据。
- **PlotSpec**：renderer-neutral 的绘图描述。
- **Template**：描述图型结构、数据角色、允许参数和默认行为。
- **Preset**：描述出版/视觉样式，例如 Nature、Scientific、Optica、Presentation、Dark。
- **Renderer**：把 PlotSpec 映射到具体绘图库。
- **Exporter**：负责静态输出，不改变 Project 状态。

## 首版 UI 原则

~~~text
Data / Project Tree | Figure Canvas | Properties
~~~

- 左：项目、Dataset、Series 映射；
- 中：Figure；
- 右：当前选择对象属性；
- 默认参数尽量隐藏在 preset 中；
- 临时 override 明确标识，可一键 reset。

## 非目标

v0.1 不追求 Origin 的完整功能覆盖，只做高频科研图和稳定项目工作流。