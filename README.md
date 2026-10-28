# 知习 · USM Study Studio

为六门 USM 课程准备的学习系统，支持多位用户独立保存笔记与学习记录。

- 正式网站：[知习学习空间](https://usm-study-studio.famous-map-1116.chatgpt.site)
- 公开源码：[Hbw1201/usm-study-studio](https://github.com/Hbw1201/usm-study-studio)

网站入口公开可访问，课程资料和个人记录仍需应用账号登录。GitHub 保存源码；后端、D1 数据库与 R2 文件存储由 Sites 托管。

## 功能

- 用户名和密码登录；账号独立保存笔记、图片、进度和复习记录，共同读取课程资料。
- 六门课程、54 份教学资源，按课程和课件／作业／Coursework 分类，支持搜索与学习进度。
- 内置课件阅读：18 份原生 PDF 连续滚动，28 份 PPT 共 793 页按原版幻灯片翻页；3 份 Word 转 PDF 阅读。视频和图片可以直接查看，ZIP 提供下载。
- 首页和课程页提供本次新增资料入口；学习计划页展示共享的学校通知、考试时间和作业日期，个人计划仍由各账号独立维护。
- 所有原文件保留下载入口。Office 预览为静态 PDF，动画和内嵌视频在预览中不播放；独立 MP4 可播放。
- 笔记按六门课程独立整理，新建笔记自动归入当前课程。随课笔记保留课件关联。
- Markdown 编辑器：桌面左右分栏，左边写 Markdown，右边展示真正 PDF；手机可在编辑与预览之间切换。
- 图片上传、拖放、剪贴板粘贴，自动插入 Markdown 语法。支持 PNG/JPEG/WebP/GIF，单张最大 8 MB，像素最大 4000 万。每篇 PDF 最多 40 张图片，GIF 在 PDF 中使用静态首帧。
- PDF 使用 OFL 授权 Noto Sans SC 字体，中文可选择、复制；支持标题、粗体、列表、引用、代码、表格、链接、图片与自动分页。
- 导出 PDF；导出 Markdown 时，无图片输出 .md，有图片输出包含 .md 和 images/ 的 ZIP，自动改写为相对图片路径。
- 笔记自动保存，并可转成复习卡片；24 张种子卡片具有真实讲义文件和页码来源，四档间隔复习评分。
- 学习计划、专注计时、JSON 备份；按身份隔离的数据存储、并发版本检查和离线待同步备份。

## 本地开发

需要 Node 22.13+ 和 npm：

~~~sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_loose_marvel_zombies.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_solid_stephen_strange.sql
node scripts/seed-course-assets.mjs
node --experimental-strip-types scripts/create-study-users.mjs
npm run dev -- --port 5173 --hostname 127.0.0.1
~~~

已有数据库不要重复执行初始迁移。本次会话已初始化 D1、R2 课程文件，可直接运行：

~~~sh
node scripts/run-framework.mjs dev --port 5173 --hostname 127.0.0.1
~~~

本地预览现在使用独立账号登录，入口为 [本地登录页](http://127.0.0.1:5173/login)。已开通 Han Bowen 与 Cao Chengwei 两个账号。账号创建脚本从隐藏标准输入读取一行 JSON 数组，每项包含 id、displayName、password；口令不写入源码、命令参数或日志。已有同 ID 账号会跳过，不重置口令。数据库只保存带随机盐的 PBKDF2 哈希；会话为随机令牌的哈希，Cookie 使用 HttpOnly、SameSite=Lax，HTTPS 下启用 Secure，7 天到期。登录接口包含账号/IP 限流、同源校验和输入大小限制。

旧 local_seedy 试用记录原样保留，并另存于 outputs/legacy-preview-workspace.json，没有自动归属给任一新账号。新账号各自从空白个人记录开始；六门课程和全部课件保持共享。本地数据与生产数据独立。课程二进制不在 Git 中；新环境需重新准备素材并导入。Sites 平台访问范围为 public，应用内账号仍控制课程和个人数据访问。

## 素材准备

~~~sh
node scripts/prepare-course-assets.mjs
node scripts/seed-course-assets.mjs --dry-run
node scripts/seed-course-assets.mjs
node scripts/seed-course-assets.mjs --verify-only
~~~

prepare 脚本从上级六门课程目录定位原件，在 outputs/course-assets/ 生成按课程整理的原件和 PDF 预览，并生成 content/material-previews.json。Office 转换使用本机便携 LibreOffice，不修改原件。含视频的 PPT 预览保留静态封面，移除 PDF 视频动作以缩小体积。转换脚本会检查每份 PPT 的幻灯片数与 PDF 页数。

seed 脚本只写本地 R2（没有远程模式），验证文件大小与 SHA256。当前清单包含 54 原件 + 31 预览，共 85 对象；准备与上传脚本均从 catalog 和 manifest 推导数量，并验证完整性、唯一性与路径边界。

prepare 按 SHA256 比较源文件与 staging，同大小的改版文件也会刷新并重新生成 Office 预览。未变化的已验证预览直接复用；转换失败时不在清单中发布过时的预览。

## 验证

~~~sh
node --experimental-strip-types --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
~~~

覆盖口令哈希、会话 Cookie、同源校验、登录输入边界和限流窗口，以及间隔复习、备份结构、课程来源、图片格式与限额、用户图片隔离、视频/PDF Range、Unicode 下载文件名、Markdown 安全处理、中文 PDF 和图片嵌入。

接口集成验证可运行 node --experimental-strip-types tests/account-api.integration.mjs，按隐藏标准输入提示提供两组 username/password。测试验证两个账号登录、笔记和图片隔离、旧窗口保护、当前 catalog 中的全部共享课件、视频 Range 和退出后的会话撤销；测试笔记会恢复为原状态。报告只记录检查结果，不包含口令和 Cookie。设置 STUDY_TEST_URL 为正式站点 origin 可执行线上验证；不设置时测试 localhost。

浏览器验证：登录与退出、账号显示、课程隔离、Markdown 编辑和自动保存、图片上传与 PDF 预览、带图 PDF 下载、Markdown 图片包下载、原版 PPT 翻页与页码边界、PDF 连续阅读、手机布局。

## 数据与访问

- 笔记、进度、计划、复习记录使用 D1；上传图片使用 R2，每位用户有独立命名空间。
- 教学资料使用 R2 中的固定目录，只允许已登录用户读取 catalog 内资源。源码仓库不包含课程二进制、笔记数据、用户上传图片。
- 本地数据目录 .wrangler/、转换工具 .sites-runtime/、准备素材 outputs/ 均已忽略。
- JSON 备份不含图片二进制；单篇带图笔记请导出 Markdown 图片包，或导出 PDF。备份里的图片地址只在原站点和原账号下有效。
- 笔记排版在浏览器内完成，不发送给第三方转换服务。首次生成会加载约 16 MB 的中文字体。
- 课程目录排除学生联系表和个人提交文件。最近课程目录核对日期记录在 catalog.snapshot；共享通知来源保存在 content/course-updates.json。外部 Codex 定时任务每三天通过学校已登录会话检查更新，登录过期时需恢复会话，网站本身不持有学校登录凭据。

## 发布状态

网站使用上方正式地址，源码同步到 Hbw1201/usm-study-studio 的 main 分支。更新网站时执行 Sites 原生源码同步、保存版本和部署流程；向 GitHub 推送代码不会自动修改线上版本。同步报告保存在本地 outputs/sync-checks，只有正式部署、文件上传和两账号核验全部成功才记录完成。

生产初始化使用 scripts/provision-production.mjs，通过隐藏 stdin 接收 {baseUrl,token,users}；users 只包含两个约定身份及密码哈希，不传明文密码。课件严格按照当前 manifest 的完整白名单导入，大文件按 16 MiB 分块，校验本地 SHA256、远端文件大小与摘要元数据。已存在的账号不会重置密码。

日常课程同步必须使用 {baseUrl,token,materialsOnly:true}，并省略 users。这种模式完全跳过账号写入，只有远端对象的大小与 SHA256 都匹配时才跳过上传；个人 workspace 与上传图片不属于同步对象。

初始化接口默认返回 404；只有配置强随机 STUDY_PROVISION_TOKEN 运行时秘密后才临时启用。数据导入后删除该秘密并重新部署即可关闭入口。所有本地原课件和旧试用记录继续保留，源码仓库不包含数据库、会话、密码或课程二进制。


## Bilingual knowledge and practice

The shared knowledge library is authored from the downloaded course files in `content/knowledge/{courseCode}.json`. Each material has Chinese/English explanations, grouped concepts, labelled conceptual relationships, source-page citations, and single-answer MCQs with bilingual rationales. Course pathways connect reading with labs and projects. The content is shared by both accounts; it is not stored in either user's personal notes.

The **知识与练习** navigation opens the course library. Each material also exposes **双语知识点**, **知识脉络**, and **选择题** tabs. Learners can switch Chinese/English/bilingual display, search concepts, collapse the tree, open the cited source page, quote a concept into their own Markdown note, or add it as a review card. Quizzes support unanswered/all/wrong-question sessions and an explicit concept-to-question coverage table.

Quiz responses are stored in the existing authenticated, revision-checked workspace under `quizzes`. Old workspaces and JSON backups receive an empty quiz record through schema defaults; notes, progress, tasks, uploaded images and spaced-review records are preserved. A question-content fingerprint invalidates an outdated answer when that question changes. A retry updates only that user's latest response and attempt count. These are practice exercises rather than official assessment submissions.

### Updating knowledge alongside course files

Read `content/knowledge/SCHEMA.md` before editing. Preserve stable material and concept/question IDs when their meaning remains the same. Read every substantive source page, including diagrams. Cover important definitions, framework components, distinctions, processes, calculations and applications without imposing a fixed item limit. Use plausible distractors and one unambiguous best answer. Every knowledge concept must have a relevant question; every cited page must exist and be included in coverage. Explicitly record title, repeated and administrative pages that need no independent concept. Mark conflicts, historical statistics, non-paginated sources and any limits of video analysis honestly.

When source content changes, update its bilingual explanations, links, MCQs, course pathway, coverage decisions and `sourceSha256` together. Merely changing the fingerprint does not update teaching content. Retain originals and existing user data.

Validation:

```text
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
node --experimental-strip-types tests/knowledge-api.integration.mjs
```

The integration script takes the two login objects only through hidden stdin; optional `STUDY_TEST_URL` selects the deployed origin. It checks shared UI availability, durable quiz writes, user isolation, stale-account rejection, and preservation of existing notes/progress. It restores its test response using revision checks.

管理员新增账号使用临时启用的 /api/provision 的 createUser 操作，提交单个规范化身份和带随机盐的密码哈希。该操作仅插入新账号，身份或用户名已存在时返回 409，不重设密码或写入个人工作区。完成后删除 STUDY_PROVISION_TOKEN 并重新部署，使入口恢复关闭。
