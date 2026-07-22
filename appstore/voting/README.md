# RoomHash 分布式公开投票 WASM

这是可嵌入 RoomHash 消息内运行的 Rust WASM 投票应用。投票创建、身份
Hash、公开事件、按用户排重、改票 LWW、本地统计、原始票据审计、持久化和
快照合并均在 WASM 内完成。模块无 imports，不自行访问网络或 DOM。

> 不同节点看到的统计结果可能不同，取决于各自实际收集到的数据。这是每个
> 收集者的本地可见视图，不是全局强一致结果。

## 构建和检查

需要 Rust、`wasm32-unknown-unknown` target 和 Node.js 20+：

```sh
rustup target add wasm32-unknown-unknown
npm run build
npm run check
```

稳定发布产物位于 `dist/`：

- `roomhash.json`：`schema: roomhash.app/v1`、`runtime: wasm`、
  `abi: roomhash-form-v1`
- `voting.wasm`：无 imports 的 ABI v2 模块
- `README.md` 与 `LICENSE`

`npm run check` 会执行格式、Clippy、Rust 单元测试、release WASM 构建、
imports/exports/manifest/hash 检查，并通过真实 WASM 内存 ABI 完成初始化、创建
投票、投票、公开表格和快照的端到端检查。

## ABI v2

模块导出 `memory` 以及：

```text
rh_abi_version() -> 2
rh_alloc(len) -> ptr
rh_dealloc(ptr, len)
rh_init(ptr, len) -> success
rh_dispatch(ptr, len) -> success
rh_output_ptr() -> ptr
rh_output_len() -> len
```

输入输出均为 UTF-8 JSON。`rh_init` 接收：

```json
{
  "nickname": "Alice",
  "peerId": "peer-id",
  "identitySeed": "64-char-hex",
  "channelId": "channel-id",
  "instanceId": "vote-id",
  "savedState": null
}
```

WASM 内使用 SHA-256 对 `identitySeed` 再哈希生成公开 `voterHash`。
`rh_dispatch` 支持：

- `{"kind":"action","action":"create-poll","values":{"title":"...","options":"A\nB"}}`
- `{"kind":"action","action":"cast-vote","values":{"optionId":"..."}}`
- `{"kind":"remote","event":{...}}`
- `{"kind":"state-request"}`
- `{"kind":"snapshot","state":{...}}`

输出包含声明式 `view`，本地产生且应公开广播的 `events`，可选 `snapshot`，
以及每次都返回的 `persist` 状态。宿主负责把 `events` 放入现有 RoomHash Mesh；
Mesh 的 frame 去重、TTL、多跳转发和重连交换负责事件投递，WASM 则按 event ID
拒绝 echo，并以公开事件全集实现 anti-entropy 快照合并。

## 收敛规则

- 创建投票是公开 `poll-created` 事件；若并发创建，event ID 字典序较大的定义
  成为当前投票，所有节点确定性收敛。
- 每张公开 ballot 包含 nick、voterHash、optionId、revision、pollId、eventId。
- 当前投票按 `voterHash` 只计一票；最大 `(revision,eventId)` 胜出，因此可改票
  且乱序投递仍收敛。
- 事件 ID 是规范字段的 SHA-256。重复 remote event 和 snapshot echo 不会重复
  计票；所有合法事件保留在公开状态中，当前 winner 显示在审计表。

## 信任边界

公开 user hash 和 event ID 是排重/完整性标识，并非密码学身份签名。当前 ABI
由可信 RoomHash 宿主注入 identitySeed，可避免普通 UI 自选 hash；但若宿主或
恶意运行时能伪造 identitySeed、公开事件或超大 revision，WASM 本身无法证明
真实身份。高风险投票仍需宿主签名、公钥绑定和 revision 策略。

MIT License
