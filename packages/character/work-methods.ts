/** Short task-specific methods; no additional model call or automatic delegation. */
export function workMethod(request: string): string {
  const methods: [RegExp, string][] = [
    [/修复|报错|bug|\bfix\b/i, '小范围修复：定位问题，做最小改动，运行与问题直接相关的验证；交付说明修改、验证和剩余限制。'],

    [/改写|润色|总结|摘要|文案|文本|通知|行动表|分步骤|rewrite|summari/i, '文本处理：先明确用途，保留原文事实和数字；按所需风格改写，交付可直接使用的内容，不虚构来源。'],
    [/讲解|理解|介绍|架构|调用|配置|函数|explain/i, '项目讲解：先查看入口和说明，再按实际调用关系解释；引用具体文件，标明尚未核实之处。'],
    [/盘点|整理|重命名|移动|文件夹|目录|分组|organize/i, '文件整理：先盘点并给出变更预览，避免覆盖同名文件；涉及删除先确认。完成后列出处理数量和路径。'],
  ]
  const selected = methods.find(([pattern]) => pattern.test(request))
  return `[Anna 工作方法] ${selected?.[1] ?? '先理解目标，独立完成能完成的部分。'}先搜索定位再读取，避免重复读取大文件。按需委托，避免无必要的额外模型审阅。`
}
