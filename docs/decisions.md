# 架构决策记录（ADR）

记录本仓库的架构取舍。AGENTS.md 路由指向此处。

## 模板

### ADR-XXX [标题]
- 状态：提案 / 已采纳 / 已废弃 / 被 ADR-YYY 取代
- 日期：YYYY-MM-DD
- 背景：约束 / 痛点
- 选项：A / B / C —— 优劣
- 结论：选哪个、为什么
- 影响：改变 / 风险 / 后续
- 关联：PR / Issue

<!-- 示例

### ADR-001 服务调用统一走 OpenFeign
- 状态：已采纳
- 日期：YYYY-MM-DD
- 背景：业务里散落 RestTemplate，超时/重试/埋点不一致。
- 选项：
  1. OpenFeign —— 声明式、易统一拦截
  2. RestClient —— 可控但样板多
  3. 保留 RestTemplate —— 历史包袱重
- 结论：选 OpenFeign，声明式契合多服务调用，便于统一超时/熔断。
- 影响：新增 feign 依赖与全局配置；存量 RestTemplate 逐步迁移。
- 关联：PR #

-->

---

<!-- 新条目追加在下方 -->
