import type { EnhanceInput } from './types';

type Field = {label:string; value:string};
type Section = {title:string; fields:Field[]};

const headingPattern = /^\[([^\[\]\n：:；。]{1,20})\]$/u;
const inlineHeadingValuePattern = /^\[([^\[\]\n：:；。]{1,20})\][：:\s]+([^：:\[\]\n]+)$/u;
const fieldPattern = /^([^：:\[\]；。\n]{1,18})[：:]\s*(.+)$/u;

function cleanValue(value: string): string {
  return value.trim().replace(/[；;。．.]+$/u,'').trim();
}

function defaultFieldLabel(title: string): string {
  return /限制|排除/u.test(title) ? '避免' : /光线|构图/u.test(title) ? '呈现' : /场景/u.test(title) ? '环境' : '描述';
}

function parseSections(raw: string): Section[] | null {
  const normalized = raw.replace(/\r\n?/g,'\n')
    .replace(/\s*(\[[^\[\]\n：:；。]{1,20}\])\s*(?=[^：:\[\]；。\n]{1,18}[：:])/gu,'\n$1\n')
    .replace(/[ \t]*(\[[^\[\]\n：:；。]{1,20}\])[ \t]+(?=[^：:\n]+)/gu,'\n$1 ')
    .replace(/([^\n])[ \t]*(?=\[[^\[\]\n：:；。]{1,20}\])/gu,'$1\n')
    .replace(/([；;。])\s*(?=[^：:\[\]；;。\n]{1,18}[：:])/gu,'$1\n');
  const lines = normalized.split('\n').map(line=>line.trim())
    .filter(line=>line && !/^[；;。.．]+$/u.test(line));
  const sections: Section[] = [];
  for (const line of lines) {
    const heading = headingPattern.exec(line);
    if (heading) {
      sections.push({title:heading[1].trim(),fields:[]});
      continue;
    }
    const inlineHeading = inlineHeadingValuePattern.exec(line);
    if (inlineHeading) {
      const title = inlineHeading[1].trim();
      const val = cleanValue(inlineHeading[2]);
      if (title && val) {
        sections.push({title,fields:[{label:defaultFieldLabel(title),value:val}]});
        continue;
      }
    }
    const cleanedLine = line.replace(/^[*-]\s*/u,'');
    const field = fieldPattern.exec(cleanedLine);
    if (field && sections.length) {
      const label = field[1].trim();
      const value = cleanValue(field[2]);
      if (!label || !value) return null;
      sections[sections.length-1].fields.push({label,value});
      continue;
    }
    if (!sections.length) return null;
    // 模型在 [标题] 下直接写了自然段而未写“字段：”前缀时，归入当前段而非整段降级为 [画面]
    const val = cleanValue(cleanedLine);
    if (!val) continue;
    const current = sections[sections.length-1];
    if (current.fields.length) {
      const last = current.fields[current.fields.length-1];
      last.value = `${last.value}，${val}`;
    } else {
      current.fields.push({label:defaultFieldLabel(current.title),value:val});
    }
  }
  return sections.length && sections.every(section=>section.title && section.fields.length) ? sections : null;
}

function renderSections(sections: Section[]): string {
  return sections.map(section=>`[${section.title}]\n${section.fields.map((field,index)=>
    `${field.label}：${field.value}${index===section.fields.length-1?'。':'；'}`).join('\n')}`).join('\n\n');
}

function wrapProse(raw: string): Section[] {
  const prose = raw.replace(/^```[^\n]*\n?/u,'').replace(/```$/u,'')
    .replace(/\s+/gu,' ').trim().replace(/[；;。．.]+$/u,'');
  const clauses = prose.split(/[；。]+/u).map(item=>item.trim()).filter(Boolean);
  let first = clauses.shift() || prose;
  let rest = clauses.join('，');
  if (!rest) {
    const comma = first.indexOf('，');
    if (comma>4 && comma<first.length-5) {
      rest = first.slice(comma+1).trim();
      first = first.slice(0,comma).trim();
    }
  }
  const sections: Section[] = [{title:'画面',fields:[{label:'描述',value:first||'家纺产品展示'}]}];
  if (rest) sections.push({title:'呈现',fields:[{label:'要求',value:rest}]});
  return sections;
}

const clauseBoundary = /[，,。；;\n]|但|不过|然而/gu;
const textCue = /写上|写着|写有|写(?!出)|印上|印有|绣上|绣有|文字(?:内容)?[：:是为]|文案[：:是为]|标语[：:是为]|标题[：:是为]|字样[：:是为]/gu;
const negation = /不要|不含|避免|禁止|不许|不准|不得|不能|无需|不需要|别|无/u;

function clauseStart(text: string, position: number): number {
  let start = 0;
  for (const match of text.slice(0,position).matchAll(clauseBoundary)) start = match.index! + match[0].length;
  return start;
}

function isNegatedCue(text: string, cueIndex: number): boolean {
  return negation.test(text.slice(clauseStart(text,cueIndex),cueIndex));
}

/** Extract only literal text the user positively asked to render, not quoted product names. */
function requestedRenderedText(text: string): string[] {
  const found = new Set<string>();
  const quoted = /[“"「『]([^”"」』\n]{1,60})[”"」』]/gu;
  for (const match of text.matchAll(quoted)) {
    const start = match.index!;
    const before = text.slice(clauseStart(text,start),start);
    const after = text.slice(start+match[0].length,start+match[0].length+8);
    const cue = [...before.matchAll(textCue)].at(-1);
    const cueBefore = cue && before.length-(cue.index!+cue[0].length)<=10;
    const cueAfter = /^(?:字样|文字|文案|标语|标题)/u.test(after);
    if ((cueBefore && !isNegatedCue(text,clauseStart(text,start)+cue!.index!)) ||
        (cueAfter && !negation.test(before))) found.add(match[1].trim());
  }
  const bareCue = /写上|写着|写有|写(?!出)|印上|印有|绣上|绣有|文字(?:内容)?[：:是为]|文案[：:是为]|标语[：:是为]|标题[：:是为]|字样[：:是为]/gu;
  for (const cue of text.matchAll(bareCue)) {
    if (isNegatedCue(text,cue.index!)) continue;
    const rest = text.slice(cue.index!+cue[0].length).split(/[，,。；;\n]|但|不过|然而/u,1)[0].trim();
    const quotedValue = /^[“"「『]([^”"」』\n]+)[”"」』]/u.exec(rest);
    const value = (quotedValue?.[1] || rest.replace(/(?:字样|两个字|三字|四字)$/u,'').trim()).trim();
    if (value && value.length<=30 && !negation.test(value) && !/[：:]/u.test(value)) found.add(value);
  }
  return [...found];
}

function textField(section: Section, field: Field): boolean {
  return /文字|文案|标语|标题|字样|内容/u.test(section.title+field.label) ||
    /写上|写着|写有|写(?!出)|印上|印有|绣上|绣有/u.test(field.value);
}

function negativeField(section: Section, field: Field): boolean {
  return /限制|排除|负面/u.test(section.title) || /避免|排除|禁止|不要|负面/u.test(field.label);
}

function normalizeRenderedText(sections: Section[], literals: string[], rawInputText = ''): void {
  const present = new Set<string>();
  const trimmedInput = rawInputText.trim();
  const literalPattern = literals.length ? new RegExp(literals.sort((a,b)=>b.length-a.length)
    .map(item=>item.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gu') : null;
  for (const section of sections) for (const field of section.fields) {
    const isArtTextField = /(?:艺术字|立体字|字体|文字|字样|数字|字母|字符|排版)/u.test(field.label + field.value);
    field.value = field.value.replace(/[“"「『]([^”"」』\n]+)[”"」』]/gu, (_, inner: string) => {
      if (!literals.length && isArtTextField && trimmedInput && inner.trim() === trimmedInput) {
        return `“${inner.trim()}”`;
      }
      return inner;
    });
    if (literals.length && negativeField(section,field)) {
      field.value = field.value.replace(/(不要|不含|避免|禁止|严禁|不得|不可|不能|不允许|不出现|不显示|无)(?:任何)?(?:画面)?文字/gu,'$1其他文字');
      continue;
    }
    if (!literalPattern || !textField(section,field)) continue;
    field.value = field.value.replace(literalPattern, literal=>{present.add(literal);return `“${literal}”`;});
  }
  const missing = literals.filter(literal=>!present.has(literal));
  if (missing.length) {
    const limitIndex = sections.findIndex(section=>section.title==='限制');
    sections.splice(limitIndex<0?sections.length:limitIndex,0,
      {title:'画面文字',fields:[{label:'内容',value:`显示${missing.map(item=>`“${item}”`).join('、')}`}]});
  }
}

function explicitExclusions(input: EnhanceInput): string[] {
  const found = new Set<string>();
  const known = ['文字','人物','人像','水印','品牌标识','品牌','logo'];
  for (const match of input.text.matchAll(/(?:不要|不含|无|避免)([^。；\n]{1,50})/gu)) {
    const scope = match[1].split(/但|不过|而是/u)[0];
    for (const item of known) {
      if (item==='品牌' && scope.includes('品牌标识')) continue;
      if (scope.toLowerCase().includes(item.toLowerCase())) found.add(item);
    }
  }
  for (const item of input.context?.negative_constraints||[]) {
    const target = item.replace(/^(?:不要|不含|无|避免)(?:出现|显示|添加|包含)?/u,'').trim();
    if (target && target.length<=40) found.add(target);
  }
  return [...found];
}

function hasExclusion(sections: Section[], term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const negativeWording = new RegExp(`(?:避免|不要|不含|无|不出现|不显示|不添加|不包含|不呈现|不展示|不绘制|不渲染|严禁|禁止|不得|不可|不能|不允许)[^。；\\n]{0,20}${escaped}`,'i');
  if (term==='其他文字' && sections.some(section=>section.fields.some(field=>
    /其他(?:任何)?文字/u.test(field.value) && negativeField(section,field)))) return true;
  return sections.some(section=>section.fields.some(field=>
    field.value.toLowerCase().includes(term.toLowerCase()) && (/避免|不要|不含|排除/u.test(field.label) || negativeWording.test(field.value))));
}

/** Keep the API JSON contract while making result.prompt safe to copy as a simple sectioned prompt. */
export function formatPromptSyntax(raw: string, input?: EnhanceInput): string {
  const source = raw.trim().replace(/\r\n?/g,'\n');
  const sections = parseSections(source) || wrapProse(source);
  if (input) {
    const literals = requestedRenderedText(input.text);
    normalizeRenderedText(sections,literals,input.text);
    const missing = explicitExclusions(input).map(term=>term==='文字' && literals.length ? '其他文字' : term)
      .filter(term=>!hasExclusion(sections,term));
    if (missing.length) {
      const limit = sections.find(section=>section.title==='限制');
      if (limit) limit.fields.push({label:'避免',value:missing.join('、')});
      else sections.push({title:'限制',fields:[{label:'避免',value:missing.join('、')}]});
    }
  }
  return renderSections(sections);
}

export function isPromptSyntax(value: string): boolean {
  const sections = parseSections(value);
  return Boolean(sections && renderSections(sections)===value.trim().replace(/\r\n?/g,'\n'));
}
