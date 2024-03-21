# CNKI-Search-Enhancer

---

## 脚本功能

### 新标签页打开高级检索

中国知网（CNKI）原生的高级检索页面有以下问题：

1. [高级检索页面](https://kns.cnki.net/kns8s/AdvSearch)中缺乏打开**新的高级检索页面**的快捷方式；
2. 从[CNKI主页](https://www.cnki.net/)打开[高级检索](https://kns.cnki.net/kns8s/AdvSearch)时，会**强制刷新**已经打开的**某个**高级检索页面，造成检索结果丢失；
3. 在[高级检索页面](https://kns.cnki.net/kns8s/AdvSearch)中切换**高级检索**、**专业检索**、**作者发文检索**和**句子检索**等选项卡，会丢失原选项卡中填充的内容。

启用本脚本后，[高级检索页面](https://kns.cnki.net/kns8s/AdvSearch)将新增一个**新标签页检索**选项卡，点击后将在新标签页中打开[高级检索页面](https://kns.cnki.net/kns8s/AdvSearch)，而不会破坏既有标签页的检索结果。

---
### 自动生成专业检索式

在[高级检索](https://kns.cnki.net/kns8s/AdvSearch)选项卡填充相应内容后，点击**复制为检索式**，可以自动生成专业检索式，并复制到剪切板（测试功能）。

将该功能与**新标签页打开高级检索**相结合，可大幅简化检索操作，避免因选项卡填充内容消失而重复输入检索词。

* 示例1：
![](https://p.ipic.vip/wrhosu.png)
```
SU %= '网络药理学'
```

* 示例2：
![](https://p.ipic.vip/d5n6mw.png)
```
SU %= ('机器学习' + '深度学习') * '诊断' AND AF = '电子科技大学'
```

* 示例3：
![](https://p.ipic.vip/55s81w.png)
```
SU %= '人工智能' + '机器学习' + '深度学习' + '神经网络' AND SU %= '糖尿病' AND SU %= '诊断' + '预测' AND LY %= '国际眼科杂志'
```

---

## 注意事项

* 仅适配[新版知网](https://kns.cnki.net/kns8s/AdvSearch)；
* 自动生成检索式系测试功能，不断改进中；
* 自动生成检索式仅支持**总库**检索；
![](https://p.ipic.vip/33ixl3.png)

## 使用方法

1. 为浏览器安装 Tampermonkey 扩展（[Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/%E7%AF%A1%E6%94%B9%E7%8C%B4/iikmkjmpaadaobahmlepeloendndfphd?hl=zh-CN)、[Firefox](https://addons.mozilla.org/zh-CN/firefox/addon/tampermonkey/)、[Google Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=zh-CN&utm_source=ext_sidebar)）；
2. 安装此脚本。

