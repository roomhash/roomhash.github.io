# RoomHash Market WASM

可直接嵌入 RoomHash 消息运行的分布式 Market，使用 `roomhash-form-v1` / ABI v2。商品状态、所有权验证、排重、LWW、快照合并、购买意向加密和卖家解密全部在无 imports 的 Rust WASM 内完成。

## 构建与验证

需要 Node.js 20+、Rust 和 `wasm32-unknown-unknown` target：

```sh
npm run check
```

该命令执行 Rust 格式/Clippy、原生单元测试、release WASM 构建，以及四个独立 WASM 实例的 ABI/传播/密码学验收。发布包位于 `dist/`：

- `roomhash.json`：`roomhash.app/v1` manifest；
- `market.wasm`：ABI v2 入口；
- README、协议和许可证。

可将整个 `dist/` 复制到 RoomHash AppStore，再由宿主生成 torrent 和 HTTP seed。

## 用户流程

- 卖家发布、更新或撤下商品。标题、价格/币种、介绍、照片/视频内容寻址描述符、卖家 nick/hash/联系身份和公钥都是公开数据。
- 买家在商品卡片确认购买，填写联系方式、收货/交付方式和备注。
- WASM 内使用卖家 X25519 公钥加密敏感字段，再把密文作为公开 Mesh 事件传播。
- 卖家 WASM 使用由本机 `identitySeed` 派生的私钥解密，并醒目提示卖家主动联系买家商讨线下交付。
- 本应用没有线上付款、钱包、托管、支付状态或资金流程。

不同节点只展示自己已经收集并验证的数据。断网、分区、节点离线或快照尚未送达时，不同人看到的商品和意向数量可能不同。

## ABI

模块无 imports，导出：

```text
memory
rh_abi_version() -> 2
rh_alloc / rh_dealloc
rh_init
rh_dispatch
rh_output_ptr / rh_output_len
```

输入输出均为 UTF-8 JSON。`rh_init` 接受宿主 context；`rh_dispatch` 接受 `action`、`remote`、`state-request` 和 `snapshot`。输出包含 `view`、`events`、`snapshot`、`persist`。view 使用宿主已支持的 notice、stats、form、cards 和 table。

file 字段由宿主通过 torrent.media 变成 `{name,mime,size,sha256,magnet,webSeed}` 数组后再传入 WASM；媒体字节不会进入 Gossip JSON。

## 密码学与信任边界

- `identitySeed` 使用域分离 SHA-256 确定性派生 Ed25519 签名密钥和 X25519 加密密钥；`userHash` 绑定 Ed25519 公钥。
- 商品事件由卖家 Ed25519 签名，listing ID 以 seller hash 为所有者前缀。
- 每次购买 action 必须由宿主提供 32 字节随机值。WASM 内生成一次性 X25519 密钥，以 X25519 + HKDF-SHA-256 派生密钥并用 ChaCha20-Poly1305 加密，再由买家 Ed25519 签名公开 envelope。
- 公共事件和快照只包含密文；联系方式、收货方式和备注不进入公开 JSON。
- 观察者仍能看到双方 hash、商品 ID、意向 ID、密文大小和传播关系。加密不隐藏这些元数据。
- 公钥 hash 只能证明同一密钥，不能证明现实身份；昵称和公开联系身份仍可能被冒充。
- identitySeed 丢失后，卖家无法解密相应意向；泄漏后攻击者可以冒充身份并解密发给该密钥的密文。宿主负责安全存储和备份。
- Mesh 节点可以拒绝转发、审查或丢包。快照与排重改善最终收敛，但不保证全网送达，也不提供内容审核、履约或争议仲裁。

详见 `PROTOCOL.md`。
