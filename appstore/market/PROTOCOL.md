# RoomHash Market Protocol v1

## 身份与所有权

WASM 从宿主提供的 64 hex `identitySeed` 派生两套独立密钥：Ed25519 用于事件签名，X25519 用于购买意向加密。`userHash = SHA-256(domain || Ed25519PublicKey)`。

listing ID 格式为 `<sellerHash>:<128-bit action random prefix>`。更新和撤下必须继续携带同一个卖家公钥，并通过该公钥验证 Ed25519 签名。非所有者不能构造有效更新。

## 事件和 LWW

公开事件 schema 为 `roomhash.market/event-v1`，包含：

- `listing`：公开商品、卖家信息、媒体描述符、status、revision、eventId 和签名；
- `intent`：公开路由/身份元数据、一次性公钥、nonce、密文、revision、eventId 和买家签名。

`eventId` 是规范化 Rust struct JSON 的 SHA-256。WASM 先验证 schema、字段限制、所有权、公钥 hash、eventId 和签名，再写入状态。相同 eventId 防 echo；相同逻辑键按 `(revision,eventId)` 取最大值，确保乱序确定性收敛。

状态快照 `roomhash.market/snapshot-v1` 只包含每个 listing 和 intent 的当前公开 winner。snapshot 合并逐条执行与 remote 事件相同的完整验证，绝不信任宿主或中继。

## 购买意向加密

买家 action 包含由宿主安全随机源生成的 32 字节 `random`。WASM 将它与买家密钥和 listing ID 混合，域分离派生一次性 X25519 私钥与 96-bit nonce：

1. 一次性 X25519 私钥与 listing 中卖家 X25519 公钥计算 shared secret；
2. HKDF-SHA-256 以 listing ID 域分离 salt 和公开意向元数据作为 info，派生 256-bit key；
3. ChaCha20-Poly1305 加密 `{buyerNick,buyerHash,contact,delivery,note}`，公开元数据同时作为 AEAD AAD；
4. 买家 Ed25519 签名完整公开 envelope。

卖家用由自己的 identitySeed 派生的 X25519 私钥解密。其他实例即使收集到全部公开事件也没有解密密钥。公开 Mesh JSON 和 snapshot 不含敏感明文。

## 媒体

file 字段由宿主 seed 后变为 `{name,mime,size,sha256,magnet,webSeed}`。WASM 根据 MIME 派生公开卡片所需的 `photo|video` kind，并强制：

- JPEG/PNG/WebP/GIF 照片最多 8 个，每个 10 MiB；
- MP4/WebM 视频最多 2 个，每个 100 MiB；
- 合计最多 210 MiB；
- SHA-256 必须为 32-byte hex；至少存在 magnet 或 webSeed；webSeed 必须 HTTPS，开发期仅允许 localhost HTTP。

媒体字节不进入事件。接收宿主从 torrent 或 web seed 获取后应再次核验 SHA-256。

## Portable Surface ABI v3 调度

- init：`{nickname,peerId,identitySeed,channelId,instanceId,savedState}`；
- 通用 `text`、`pointer`、`wheel`、`key` 输入由 WASM 自己解释为表单、导航、
  搜索、选择、更新、撤下或购买动作；
- 需要发布/更新/购买时，WASM 请求 `random-bytes` 通用 effect，宿主返回 32 字节
  密码学随机值，后续密钥派生、加密与签名仍全部在 WASM 内完成；
- 文件选择通过 `pick-files` 返回已做种的内容寻址描述符，媒体通过通用
  `load-media` / `open-media` effect 使用；
- remote：单个公开 MarketEvent；
- state-request：返回公开 snapshot；
- snapshot：验证并合并公开 snapshot。

输出统一为 `{scene,effects,events,snapshot,persist}`。scene 是由 Rust 生成的
Canvas display list，不包含 HTML 表单；persist 与 snapshot 都只保存公开密文
状态，卖家每次绘制收件箱时在 WASM 内重新解密。

## 明确排除

协议递归拒绝 payment、wallet、escrow、paid、refund、transactionId 等资金流程字段。不定义线上付款、资金托管、支付状态、库存锁定、履约确认或争议仲裁。
