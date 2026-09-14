# P106｜MediaIndex HANDOFF

> 本文件是跨对话恢复入口。不得只凭聊天记忆继续。

## 1. 项目身份

- 项目：MediaIndex
- 预留编号：`P106`
- 预留路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

当前用户明确要求：暂不修改任何公共文件，只建立 P106 自有目录和长期分支。因此 `/目录.md` 尚未登记 P106。后续需要通过独立的统一仓库任务补齐共享索引，不得在当前 P106 开发提交中夹带。

## 2. 新对话强制读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本目录 `开发约束.md`
5. `README.md`
6. `阶段记录.md`
7. `工作记录.md`
8. `docs/algorithm-validation.md`
9. `docs/benchmark-plan.md`
10. `设计与演进.md`
11. 实时比较 `main / p106-stable / p106-exp`

## 3. 当前断点

当前处于 **Phase 0：图片算法 A 阶段验证**。

已经由用户本机完成并可追溯的受控测试包括：

- 全局感知哈希对 JPEG 重压缩、缩放、PNG 转换表现稳定。
- 默认 Mean hash 对裁剪非常弱。
- DoubleGradient 放宽阈值后可恢复 Crop10，但 Crop30 仍失效。
- SIFT + Lowe ratio + RANSAC 在受控 Crop30 集上 Top-1 为 20/20。
- 同一 SIFT 测试的初始 verdict 阈值对 20 张 unrelated 产生 19/20 假阳性，因此该判定阈值明确作废，不能进入正式设计。

准确数字见 `docs/algorithm-validation.md`。

## 4. 当前唯一下一步

继续 A 阶段自验证，不要求用户手工调参：

1. A1：真实自然图片正样本鲁棒性。
2. A2：难负样本与近重复但非同源样本。
3. A3：候选召回、多区域 hash 与 10 万至 50 万级规模压力测试。
4. A4：算法冻结后，再用少量用户真实素材做域验收。

在 A1 至 A3 形成可复现实验记录前，不开始正式 UI，不冻结生产阈值。

## 5. 写入边界

当前只允许修改：

```text
projects/1-桌面软件/106-MediaIndex/
```

以及后续用户明确授权的 P106 专属 CI。当前不得修改：

- `/目录.md`
- `/GPT_RULES.md`
- 分类 `开发约束.md`
- 其他 P101 至 P105 项目
- 公共 workflow
- 其他共享入口

## 6. 恢复模板

```text
P106 MediaIndex
main: <实时 SHA>
p106-stable: <实时 SHA / ahead-behind>
p106-exp: <实时 SHA / ahead-behind>
catalog registration: pending / completed
phase: <当前阶段>
verified benchmark: <最后一轮编号>
invalidated assumptions: <已否决规则>
next action: <唯一明确断点>
```
