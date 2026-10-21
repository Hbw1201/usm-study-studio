# 知习 · USM Study Studio

为六门 USM 课程准备的个人学习系统。当前交付为本地可交互预览，尚未推送用户 GitHub 仓库或部署到生产环境。

## 功能

- 用户名和密码登录；账号独立保存笔记、图片、进度和复习记录，共同读取课程资料。
- 六门课程、48 份教学资源，按课程和课件／作业／Coursework 分类，支持搜索与学习进度。
- 内置课件阅读：17 份原生 PDF 连续滚动，24 份 PPT 共 622 页按原版幻灯片翻页；两份 Word 转 PDF 阅读。视频和图片可以直接查看，ZIP 提供下载。
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

本地预览现在使用独立账号登录，入口为 http://127.0.0.1:5173/login。已开通 Han Bowen 与 Cao Chengwei 两个账号。账号创建脚本从隐藏标准输入读取一行 JSON 数组，每项包含 id、displayName、password；口令不写入源码、命令参数或日志。已有同 ID 账号会跳过，不重置口令。数据库只保存带随机盐的 PBKDF2 哈希；会话为随机令牌的哈希，Cookie 使用 HttpOnly、SameSite=Lax，HTTPS 下启用 Secure，7 天到期。登录接口包含账号/IP 限流、同源校验和输入大小限制。

旧 local_seedy 试用记录原样保留，并另存于 outputs/legacy-preview-workspace.json，没有自动归属给任一新账号。新账号各自从空白个人记录开始；六门课程和全部课件保持共享。本地数据与未来生产数据独立。课程二进制不在 Git 中；新环境需重新准备素材并导入。Sites 平台本身的私有访问限制保留，与应用内账号是独立的访问层。

## 素材准备

~~~sh
node scripts/prepare-course-assets.mjs
node scripts/seed-course-assets.mjs --dry-run
node scripts/seed-course-assets.mjs
node scripts/seed-course-assets.mjs --verify-only
~~~

prepare 脚本从上级六门课程目录定位原件，在 outputs/course-assets/ 生成按课程整理的原件和 PDF 预览，并生成 content/material-previews.json。Office 转换使用本机便携 LibreOffice，不修改原件。含视频的 PPT 预览保留静态封面，移除 PDF 视频动作以缩小体积。转换脚本会检查每份 PPT 的幻灯片数与 PDF 页数。

seed 脚本只写本地 R2（没有远程模式），验证文件大小与 SHA256。当前 48 原件 + 26 预览共 74 对象，约 865 MiB。

## 验证

~~~sh
node --experimental-strip-types --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
~~~

覆盖口令哈希、会话 Cookie、同源校验、登录输入边界和限流窗口，以及间隔复习、备份结构、课程来源、图片格式与限额、用户图片隔离、视频/PDF Range、Unicode 下载文件名、Markdown 安全处理、中文 PDF 和图片嵌入。

本地接口集成验证可运行 node --experimental-strip-types tests/account-api.integration.mjs，按隐藏标准输入提示提供两组 username/password。测试验证两个账号登录、笔记和图片隔离、旧窗口保护、全部 48 份共享课件、视频 Range 和退出后的会话撤销；测试笔记会恢复为原状态。报告只记录检查结果，不包含口令和 Cookie。

浏览器验证：登录与退出、账号显示、课程隔离、Markdown 编辑和自动保存、图片上传与 PDF 预览、带图 PDF 下载、Markdown 图片包下载、原版 PPT 翻页与页码边界、PDF 连续阅读、手机布局。

## 数据与访问

- 笔记、进度、计划、复习记录使用 D1；上传图片使用 R2，每位用户有独立命名空间。
- 教学资料使用 R2 中的固定目录，只允许已登录用户读取 catalog 内资源。源码仓库不包含课程二进制、笔记数据、用户上传图片。
- 本地数据目录 .wrangler/、转换工具 .sites-runtime/、准备素材 outputs/ 均已忽略。
- JSON 备份不含图片二进制；单篇带图笔记请导出 Markdown 图片包，或导出 PDF。备份里的图片地址只在原站点和原账号下有效。
- 笔记排版在浏览器内完成，不发送给第三方转换服务。首次生成会加载约 16 MB 的中文字体。
- 课程目录排除学生联系表和个人提交文件。资料快照日期为 2026-10-21，不自动抓取 eLearn 更新。

## 发布状态

保留 .openai/hosting.json 中已有 Sites project_id 和 owner-private 状态。尚未保存或部署生产版本。正式上线需要使用 Sites 原生源同步与发布流程，并将课程文件迁移到生产存储；本地 seed 不会上传外网。GitHub 源码仓库仍待创建及推送。
