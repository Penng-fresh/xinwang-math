// ============================================================
// 有理数运算（初一，加减法链条为主）专用的批改校验模块。
// 包含：
//   1. VERIFY_SYSTEM_PROMPT —— 第二次AI调用（纯文字+思考模式）用来复核
//      issues 是否分类准确、描述是否具体的专用提示词。
//   2. codeVerifyRationalSteps —— 【方案B】用 BigInt 精确分数运算，对
//      "移项归类/分组求和"这类步骤做穷举验算，取代 AI 自己不可靠的演算。
// 从 api/grade.js 拆分出来，是为了随着题型越来越多（混合运算、以后的
// 二次根式等），每种题型的判断逻辑都能独立成一个小文件，改动一种题型
// 不必牵动其他题型、也不必整个 grade.js 文件越堆越大。
// ============================================================

const VERIFY_SYSTEM_PROMPT = `你是一位极其严谨的数学验证专家，任务是复核另一位阅卷老师给出的批改结果里，"issues"数组中的每一条判定**不仅要验证对错，更要验证分类是否准确**。

你会收到若干道题目，每道题目包含：该题学生解题过程的逐行内容（transcription），以及当前被判定为"有问题"的 issues 列表。

【最容易出问题的地方，请特别注意】另一位阅卷老师经常会犯这样的错误：明明发现某一步的数字不对，但归因归错了方向——比如看到"25/64"这个不合理的结果，就笼统地说"计算 -4×(-1/64) 时数值算错了"，但实际上真正的病根可能是**这两个数字根本不是同一次运算的产物**（比如分子25来自另一个独立的项，分母64来自这一项），学生根本没有"算错乘法"，而是把两个不同项的数字拼到了一起。这种"表面现象对了、但归因错了"的情况，光"验证结果对不对"是发现不了的，必须重新去追溯每个数字的来源。

请对每一条 issue，按以下步骤重新分析（不只是简单地打对错勾）：

第一步，追溯来源：找到这条 issue 里出现的每一个数字，回到原式（transcription 的前几行）里，确认这个数字具体是从哪一步、哪一项计算出来的。

第二步，判断错误的真正机制，对照下面的分类框架，重新确定这条 issue 应该属于哪一类（如果发现原来标注的 type 不准确，必须改正，不要因为"原来就是这么标的"而沿用错误分类）：
- 运算顺序错误：如果你发现某一步里的数字，其分子/分母/系数分别来自加减号两侧的不同项（也就是说这两个数字压根不该出现在同一次运算里），这属于"运算顺序错误"（跨项拼凑），不是"计算错误"，也不是"漏负号"。描述时必须明确指出：具体是哪个数字，来自哪一项，被错误地和另一项的哪个数字拼在了一起。
- 漏负号：仅当参与运算的两个数字确实来自同一次加减运算、只是最终结果的正负号判断错了，才用这个分类。【重要】在判定漏负号之前，必须先确认：上一行的所有项，是否存在某种把它们完整划分成若干组（每一项带着自己的符号和数值完整参与某一组，不能拆分单项、不能凭空引入数字）、使得每组内部相加减后恰好能得到这一行写出的数字。请按两种情况处理：(a) 如果存在这样的合法分组、且分组内部算对了，只是学生跳过了"移项归类"这个中间步骤直接写出分组得数——这应改判为"预处理不彻底"（跳步），description 如实写"跳过了移项归类这一步，直接写出分组结果"，不能保留或编造一套学生实际没有用过的"从左到右计算导致漏负号"的演算说辞，那是凭空捏造、会误导学生。(b) 只有穷尽所有分组方式都推不出学生写的数字，才保留或新增真正的漏负号判定，且演算必须针对学生实际使用的分组方式，不能是你臆造的分组。
- 转写(OCR)误读排查：如果某一行的数字，无论怎么合理分组都推不出下一行的结果，请先检查是不是transcription 本身抄错了形近数字（如"3"与"9"、"1"与"7"）——把可疑数字替换成形近的另一个数字，看是否能让前后两行完全自洽；如果能，应判定为转写错误而非学生的计算错误，需要在description里注明"疑似识别有误，原始转写可能是XX"，并相应删除或修改这条issue，不能把识别错误算在学生头上。
- 乘方括号错误：仅当学生真的把 -aⁿ 和 (-a)ⁿ 弄反了、算出的数值体现出这种混淆，才用这个分类；把"÷aⁿ"等价改写成"×(1/a)ⁿ"是合法变形，不属于此类。
- 预处理不彻底（跳步）：小数没化最简分数、带分数没化假分数、除法没有先转成乘倒数再计算，这类"该做的等价变形没做"的情况。
- 如果代入数值验证后发现某个"等价变形"其实是完全正确的（例如 1÷aⁿ = (1÷a)ⁿ 这类恒等变形），这条 issue 判断错误，必须整条删除，不能保留。

第三步，处理重复与连锁：如果发现学生解题过程中存在 issues 里没有列出来的真实错误，请补充进去；如果多条 issues 描述的其实是同一个根源问题引发的连锁反应，只保留最早、最根本的一条。

【重要，防止遗漏】你的任务是"精修"这份 issues 清单，不是"重新生成"一份新清单。对于原始 issues 数组里的**每一条**，你都必须明确交代它的去留：保留（判断准确，原样保留）、修改（类型或描述不准，予以更正）、合并（属于同一根源的连锁反应，与另一条合并保留其中更根本的一条）、删除（代入验证后确认是误判）。除非你有明确理由判定某一条属于"合并"或"删除"，否则都必须出现在最终的 issues 数组里，不能因为把注意力放在修正某一条上，就无意中把其他没问题的条目漏掉。在最终输出前，请对照原始 issues 的条数，确认自己已经对每一条都做出了处理，而不是只处理了其中一部分。

第四步，重写 description：必须具体点出是哪个数字、来自哪一项、发生了什么错误，禁止使用"计算错误""数值不对""符号处理不规范"这类不指出具体机制的笼统措辞。

修正完成后，针对每一道题目，请重新评估 overall（如果 issues 变成空数组，overall 改为"正确"；如果原本是"正确"但你发现了遗漏的真实错误，issues 不能为空，overall 改为"有问题"）、score（可参考原有扣分幅度自行调整）、以及 summary（必须和最终的 issues 内容一致，不能自相矛盾）。

只返回 JSON，不要有任何其他文字，格式：{"problems":[{"problem_number":1,"issues":[{"line":1,"type":"错误类型","content":"该行内容","description":"含原理的说明","suggestion":"正确写法"}],"overall":"正确","score":90,"summary":"总体评价"}]}

所有字段中如果出现数学表达式（分数、根号、绝对值等），必须用 $ 符号包裹，用标准 LaTeX 语法（如 \\frac{分子}{分母}），且每一个 \\frac{...}{...} 必须左右花括号都完整闭合。`;

// ============================================================
// 兜底修复：把字符串里所有 \frac{分子}{分母 这种缺失收尾花括号的情况，
// 自动补全为完整闭合的 \frac{分子}{分母}，不影响本来就写完整的公式。
// ============================================================

function gcdBig(a, b) {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a === 0n ? 1n : a;
}
function makeFrac(n, d) {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdBig(n, d);
  return { n: n / g, d: d / g };
}
function fracAdd(a, b) { return makeFrac(a.n * b.d + b.n * a.d, a.d * b.d); }
function fracKey(a) { return a.n.toString() + "/" + a.d.toString(); }
function fracToString(a) {
  const neg = a.n < 0n;
  const absN = neg ? -a.n : a.n;
  const whole = absN / a.d;
  const rem = absN % a.d;
  let s = neg ? "-" : "";
  if (whole !== 0n) s += whole.toString();
  if (rem !== 0n) s += (whole !== 0n ? " " : "") + rem.toString() + "/" + a.d.toString();
  if (whole === 0n && rem === 0n) s += "0";
  return s;
}
function preprocessLine(line) {
  if (typeof line !== "string") return "";
  let s = line;
  s = s.replace(/\$/g, "");
  s = s.replace(/(\d)\\frac\{(-?\d+)\}\{(-?\d+)\}/g, "$1 $2/$3");
  s = s.replace(/\\frac\{(-?\d+)\}\{(-?\d+)\}/g, "$1/$2");
  s = s.replace(/又/g, " ");
  s = s.replace(/\\(?!frac)/g, " ");
  s = s.replace(/[（）]/g, (m) => (m === "（" ? "(" : ")"));
  return s;
}
function parseTerms(rawLine) {
  const s = preprocessLine(rawLine);
  const re = /([+-])?\s*\(?\s*([+-])?\s*(?:(\d+)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+))\s*\)?/g;
  const terms = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].trim() === "") { if (re.lastIndex === m.index) re.lastIndex++; continue; }
    const outerSign = m[1] === "-" ? -1n : 1n;
    const innerSign = m[2] === "-" ? -1n : 1n;
    let frac;
    if (m[3] !== undefined) {
      const whole = BigInt(m[3]), num = BigInt(m[4]), den = BigInt(m[5]);
      frac = makeFrac(whole * den + num, den);
    } else if (m[6] !== undefined) {
      frac = makeFrac(BigInt(m[6]), BigInt(m[7]));
    } else if (m[8] !== undefined) {
      frac = makeFrac(BigInt(m[8]), 1n);
    } else { continue; }
    const sign = outerSign * innerSign;
    frac = makeFrac(sign * frac.n, frac.d);
    terms.push(frac);
  }
  return terms;
}
function partitionsIntoK(n, k) {
  const results = [];
  const assignment = new Array(n).fill(-1);
  function backtrack(i, groupsUsed) {
    if (i === n) { if (groupsUsed === k) { const groups = Array.from({ length: k }, () => []); assignment.forEach((g, idx) => groups[g].push(idx)); results.push(groups); } return; }
    for (let g = 0; g < groupsUsed; g++) { assignment[i] = g; backtrack(i + 1, groupsUsed); }
    if (groupsUsed < k) { assignment[i] = groupsUsed; backtrack(i + 1, groupsUsed + 1); }
    assignment[i] = -1;
  }
  backtrack(0, 0);
  return results;
}
function checkPartitionMatch(sourceTerms, targetTerms) {
  const n = sourceTerms.length, k = targetTerms.length;
  if (k === 0 || n === 0 || k > n) return null;
  const targetKeys = targetTerms.map(fracKey).sort();
  const partitions = partitionsIntoK(n, k);
  for (const groups of partitions) {
    const sums = groups.map((idxs) => idxs.reduce((acc, idx) => fracAdd(acc, sourceTerms[idx]), makeFrac(0n, 1n)));
    const sumKeys = sums.map(fracKey).sort();
    if (sumKeys.length === targetKeys.length && sumKeys.every((v, i) => v === targetKeys[i])) return groups;
  }
  return null;
}
const CONFUSE = { "3": "9", "9": "3", "1": "7", "7": "1", "6": "8", "8": "6", "0": "8", "5": "6" };
function digitVariants(str) {
  const variants = [];
  for (let i = 0; i < str.length; i++) { const c = str[i]; if (CONFUSE[c]) variants.push(str.slice(0, i) + CONFUSE[c] + str.slice(i + 1)); }
  return variants;
}
function singleDigitRepairCandidates(fracList) {
  const candidates = [];
  for (let i = 0; i < fracList.length; i++) {
    const f = fracList[i];
    const neg = f.n < 0n;
    const absN = neg ? -f.n : f.n;
    const whole = absN / f.d, rem = absN % f.d;
    for (const v of digitVariants(whole.toString())) {
      const newAbsN = BigInt(v) * f.d + rem;
      candidates.push({ index: i, field: "整数部分", from: whole.toString(), to: v, newFrac: makeFrac(neg ? -newAbsN : newAbsN, f.d) });
    }
    if (rem !== 0n) {
      for (const v of digitVariants(rem.toString())) {
        const newAbsN = whole * f.d + BigInt(v);
        candidates.push({ index: i, field: "分子", from: rem.toString(), to: v, newFrac: makeFrac(neg ? -newAbsN : newAbsN, f.d) });
      }
    }
    if (f.d !== 1n) {
      for (const v of digitVariants(f.d.toString())) {
        const newDen = BigInt(v); if (newDen === 0n) continue;
        const newAbsN = whole * newDen + rem;
        candidates.push({ index: i, field: "分母", from: f.d.toString(), to: v, newFrac: makeFrac(neg ? -newAbsN : newAbsN, newDen) });
      }
    }
  }
  return candidates;
}
function verifyStepTransition(prevLineText, nextLineText) {
  const sourceTerms = parseTerms(prevLineText);
  const targetTerms = parseTerms(nextLineText);
  if (sourceTerms.length === 0 || targetTerms.length === 0) return { valid: null };
  if (checkPartitionMatch(sourceTerms, targetTerms)) return { valid: true };
  const repairHints = [];
  const collect = (terms, otherTerms, whichSide) => {
    for (const c of singleDigitRepairCandidates(terms)) {
      const repairedList = terms.slice();
      repairedList[c.index] = c.newFrac;
      const match = whichSide === "source" ? checkPartitionMatch(repairedList, otherTerms) : checkPartitionMatch(otherTerms, repairedList);
      if (match) {
        repairHints.push((whichSide === "source" ? "上一行" : "下一行") + `第${c.index + 1}个数的${c.field}如果是"${c.to}"而不是"${c.from}"，这一步就能对上`);
        if (repairHints.length >= 3) return;
      }
    }
  };
  collect(targetTerms, sourceTerms, "target");
  if (repairHints.length < 3) collect(sourceTerms, targetTerms, "source");
  return { valid: false, sourceValues: sourceTerms.map(fracToString), targetValues: targetTerms.map(fracToString), repairHints };
}

function computeLineTotalString(lineText) {
  const terms = parseTerms(lineText);
  if (terms.length === 0) return "";
  const total = terms.reduce((acc, t) => fracAdd(acc, t), makeFrac(0n, 1n));
  return fracToString(total);
}

// 用上面的引擎去核对"有理数运算"题型每相邻两行之间的变换，修正 AI 的判断：
// ①代码证明没问题 -> 撤销 AI 在这一行标的漏负号/计算错误/运算顺序类 issue
// ②代码证明有问题、AI 也标了 -> 把 description 换成代码算出的真实情况，不用 AI 的编造演算
// ③代码证明有问题、但 AI 完全没标（漏检）-> 由代码主动新增一条 issue，不能因为 AI
//    没发现就放过一个已经被代码精确验证过的真实计算错误
// ④代码判断不了（解析失败）-> 不动，维持原状，不额外新增判断
function codeVerifyRationalSteps(problems) {
  if (!Array.isArray(problems)) return problems;
  const RELEVANT_TYPE_RE = /漏负号|计算错误|运算顺序/;
  return problems.map((p) => {
    if (!p || typeof p !== "object") return p;
    if (!p.problem_type || !String(p.problem_type).includes("有理数")) return p;
    const lines = Array.isArray(p.transcription) ? p.transcription : [];
    if (lines.length < 2) return p;
    let issues = Array.isArray(p.issues) ? p.issues.slice() : [];
    const touchedLines = new Set(); // 记录哪些行是代码接管、重写过描述的（含代码新增的）
    for (let i = 0; i < lines.length - 1; i++) {
      const lineNum = i + 2; // transcription[i+1] 对应显示的"第(i+2)行"
      const result = verifyStepTransition(lines[i], lines[i + 1]);
      if (result.valid === null) continue; // 代码解析不了，不做任何改动
      const existingOnLine = issues.filter(
        (it) => it && it.line === lineNum && RELEVANT_TYPE_RE.test(it.type || "")
      );
      if (result.valid === true) {
        // 代码证明这一步没问题：撤销这一行相关类型的误判
        issues = issues.filter((it) => !(it && it.line === lineNum && RELEVANT_TYPE_RE.test(it.type || "")));
      } else {
        // 代码证明这一步确实对不上
        const hintText = result.repairHints && result.repairHints.length > 0
          ? `（可能原因：${result.repairHints.join("；")}，建议核对原始书写）`
          : "";
        const honestDescription = `经代码逐项核算：上一行的数字（${(result.sourceValues || []).join("、")}）无论怎样分组相加减，都无法得到这一行写出的结果（${(result.targetValues || []).join("、")}）。${hintText}`;
        const totalSum = (result.sourceValues || []).length > 0 ? computeLineTotalString(lines[i]) : "";
        const honestSuggestion = totalSum
          ? `代码核算：上一行这几个数字全部相加的准确结果是 ${totalSum}，可以用这个数核对一下这一步到底应该分组算出什么。${hintText}`
          : honestDescription;
        touchedLines.add(lineNum);
        if (existingOnLine.length > 0) {
          // AI 已经标了这一行有问题：用代码算出的真实情况替换描述，
          // 不再保留 AI 自己编的那套演算说辞。suggestion 字段也一并接管，
          // 不能只换 description——之前发现 AI 会在 suggestion 里继续编造
          // 一套"正确演算"，而且这套演算本身还可能漏项/算错。
          issues = issues.map((it) => {
            if (it && it.line === lineNum && RELEVANT_TYPE_RE.test(it.type || "")) {
              return { ...it, description: honestDescription, suggestion: honestSuggestion };
            }
            return it;
          });
        } else {
          // 【关键修复】AI 完全没发现这一行有问题（issues 里根本没有这一行的记录），
          // 但代码已经精确验算出对不上——这种情况绝不能放过，必须由代码主动
          // 新增一条 issue，否则就会出现"计算实际算错了，却因为 AI 一开始没看出来、
          // 而永远没有任何一层校验去核实"的漏洞（这正是本次导致 -17+27 被误判为
          // -10 却给了满分的根本原因）。
          issues.push({
            line: lineNum,
            type: "计算错误",
            content: lines[i + 1],
            description: honestDescription,
            suggestion: honestSuggestion,
          });
        }
      }
    }
    let result = { ...p, issues };
    // 去重：AI 有时会把同一处问题用两个不同的分类标签各报一遍（比如同一行
    // 既标了"漏负号"又标了"运算顺序错误"），代码校验会把两条描述都换成
    // 一样的诚实版本，但如果不去重，"发现X处问题"就会把同一个错误数两遍。
    // 这里对代码接管过的行做去重：同一行只保留第一条。
    const seenTouchedLines = new Set();
    result.issues = result.issues.filter((it) => {
      if (!it || !RELEVANT_TYPE_RE.test(it.type || "") || !touchedLines.has(it.line)) return true; // 非代码接管范围，不处理
      if (seenTouchedLines.has(it.line)) return false; // 同一行已经保留过一条了，这条是重复的，丢弃
      seenTouchedLines.add(it.line);
      return true;
    });
    // summary 字段（题目最上方那句总结）AI 也会自由发挥，同样可能编造未经证实的说法
    // （比如"最终结果虽凑巧正确"——这个"凑巧"本身就是编的，代码根本没法判断是不是巧合）。
    // 如果这道题剩下的 issues 全部都是代码接管过的，就把 summary 也换成中性、不带推测
    // 的版本；如果还有代码管不到的其他类型问题掺在里面，保留原 summary，避免顾此失彼。
    const remainingLineNums = result.issues.filter((it) => it && RELEVANT_TYPE_RE.test(it.type || "")).map((it) => it.line);
    const allTouched = remainingLineNums.length > 0 && remainingLineNums.every((ln) => touchedLines.has(ln));
    if (result.issues.length === 0) {
      result.summary = "解题过程规范，未发现问题。";
    } else if (allTouched) {
      result.summary = `第${[...touchedLines].sort((a, b) => a - b).join("、")}行的计算结果和上一行的数字对不上，具体原因请看下方"错误详情"（可能是识别数字有误，也可能是计算本身有误，暂无法完全确定）。`;
    }
    return result;
  });
}


export { VERIFY_SYSTEM_PROMPT, codeVerifyRationalSteps };
