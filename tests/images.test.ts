import assert from 'node:assert/strict';
import test from 'node:test';
import { hasReviewableContext, parseEnhanceInput, textOnlyInput } from '../src/server/validation';
import { parseVisionOutput } from '../src/server/vision';
import { needsRevisionResult } from '../src/server/moderation';

const png = 'data:image/png;base64,iVBORw0KGgo=';

test('reference_images accepts up to 3 http(s) URLs or image data URLs',()=>{
  const input = parseEnhanceInput({text:'抱枕',context:{reference_images:[png,' https://cdn.example.com/a.jpg ']}});
  assert.deepEqual(input.context?.reference_images,[png,'https://cdn.example.com/a.jpg']);
  assert.equal(parseEnhanceInput({text:'抱枕',context:{reference_images:[]}}).context?.reference_images,undefined);
  assert.throws(()=>parseEnhanceInput({text:'x',context:{reference_images:[png,png,png,png]}}),/最多 3/);
  assert.throws(()=>parseEnhanceInput({text:'x',context:{reference_images:['ftp://a/b.png']}}),/http/);
  assert.throws(()=>parseEnhanceInput({text:'x',context:{reference_images:['data:text/plain;base64,aGk=']}}),/base64/);
  assert.throws(()=>parseEnhanceInput({text:'x',context:{reference_images:[123]}}),/字符串/);
});

test('text models never see image data; the analysis is appended to the summary',()=>{
  const input = parseEnhanceInput({text:'抱枕',context:{reference_images:[png],reference_summary:'网站摘要'}});
  assert.equal(hasReviewableContext(parseEnhanceInput({text:'1111',context:{reference_images:[png]}})),false);
  const plain = textOnlyInput(input);
  assert.equal('reference_images' in (plain.context||{}),false);
  const withAnalysis = textOnlyInput(input,'米色亚麻抱枕，方形');
  assert.equal(withAnalysis.context?.reference_summary,'网站摘要\n参考图识别：米色亚麻抱枕，方形');
  assert.doesNotMatch(JSON.stringify(withAnalysis),/base64/);
});

test('vision verdicts are validated and fail closed on bad output',()=>{
  assert.deepEqual(parseVisionOutput(JSON.stringify({decision:'allow',categories:[],description:' 蓝白条纹四件套 '})),{decision:'allow',categories:[],description:'蓝白条纹四件套'});
  assert.deepEqual(parseVisionOutput(JSON.stringify({decision:'revise',categories:[],description:'x'})),{decision:'revise',categories:['other_sensitive'],description:''});
  assert.equal(parseVisionOutput(JSON.stringify({decision:'allow',categories:['graphic_violence'],description:'x'})).decision,'revise');
  assert.deepEqual(parseVisionOutput(JSON.stringify({decision:'allow',categories:['copyright_ip'],description:'草莓熊'})),
    {decision:'revise',categories:['copyright_ip'],description:''});
  assert.throws(()=>parseVisionOutput(JSON.stringify({decision:'allow',categories:[],description:''})));
  assert.throws(()=>parseVisionOutput(JSON.stringify({decision:'allow',categories:['unknown'],description:'x'})));
  assert.throws(()=>parseVisionOutput('not json'));
});

test('image problems ask the user to replace the image, not edit the text',()=>{
  const result = needsRevisionResult({categories:['graphic_violence']},'image');
  assert.equal(result.can_generate,false);
  assert.match(result.user_notice,/参考图/);
  assert.match(result.revision_guidance![0].reason,/^参考图/);
  assert.match(result.revision_guidance![0].suggestion,/更换/);
});
