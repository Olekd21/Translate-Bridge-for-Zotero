# 发布到 GitHub

1. 项目公开仓库为 [Translate-Bridge-for-Zotero](https://github.com/Olekd21/Translate-Bridge-for-Zotero)。
2. 将项目源码提交并推送到新仓库。上传前检查 `git status` 和暂存区，不要上传私钥、个人配置、缓存或本地工作记录。项目 `.gitignore` 已排除这些已知路径；安装包在 `dist/`，作为 Release 附件分发。
3. 在仓库 **Releases → Draft a new release** 创建版本，标签用 `v0.8.1`，标题用 `Translate Bridge for Zotero 0.8.1`，说明复制本目录 `RELEASE-0.8.1.md`。
4. 附加 `dist/translate-bridge-for-zotero-0.8.1.zip`。也可同时附加独立的 Chrome ZIP 与 Zotero XPI。
5. 不勾选 **This is a pre-release**，点击 **Publish release**。将发布页链接分享给使用者，提醒下载完整安装包；GitHub 自动生成的 Source code ZIP 是源码，不是安装包。

本项目尚未配置在线自动更新；目前按用户手册手动更新。后续版本发布前，应同步版本号、安装文件名、手册和发布说明，并完成构建及分发包校验。

官方文档：[新建仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)、[管理 Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
