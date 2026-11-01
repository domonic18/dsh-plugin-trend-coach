import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAPTER_ARTICLE_CACHE_TTL_MS,
  figureCaption,
  isChapterCacheFresh,
  isRenderableFigureUrl,
  parseFigureBlock,
  resolveFigure,
} from '../lib/client/chapter-article.js'

const figure = {
  url: 'https://media.example.com/figures/fig_demo1/cand_1.jpg?expires=1&sig=x',
  width: 1600,
  height: 900,
  alt: '均线示意',
  caption: '均线多头排列',
}

test('parseFigureBlock 只接受独立成行的 figure: 引用', () => {
  assert.deepEqual(parseFigureBlock('![均线示意](figure:fig_demo1)'), {
    figureId: 'fig_demo1',
    alt: '均线示意',
  })
  assert.deepEqual(parseFigureBlock('   ![ ](figure:fig_demo-1.2)   '), {
    figureId: 'fig_demo-1.2',
    alt: '',
  })
  assert.equal(parseFigureBlock('![外链](https://evil.example.com/a.jpg)'), 'invalid')
  assert.equal(parseFigureBlock('![内嵌](data:image/png;base64,AAAA)'), 'invalid')
  assert.equal(parseFigureBlock('正文里的 ![图](figure:fig_demo1) 不算图片块'), undefined)
  assert.equal(parseFigureBlock('普通段落'), undefined)
  assert.equal(parseFigureBlock('![图](figure:fig_中文)'), 'invalid')
})

test('resolveFigure 只按 figures 映射解析', () => {
  const hit = resolveFigure({ figureId: 'fig_demo1', alt: '均线示意' }, { fig_demo1: figure })
  assert.equal(hit.kind, 'figure')
  assert.equal(hit.figure, figure)

  const miss = resolveFigure({ figureId: 'fig_missing', alt: '缺图' }, { fig_demo1: figure })
  assert.deepEqual(miss, { kind: 'placeholder', alt: '缺图' })

  const inherited = resolveFigure(
    { figureId: 'toString', alt: '原型链' },
    { fig_demo1: figure },
  )
  assert.equal(inherited.kind, 'placeholder')
})

test('isRenderableFigureUrl 只放行无凭据的 http(s) 地址', () => {
  assert.equal(isRenderableFigureUrl('https://media.example.com/a.jpg'), true)
  assert.equal(isRenderableFigureUrl('http://127.0.0.1:3939/a.jpg'), true)
  assert.equal(isRenderableFigureUrl('data:image/png;base64,AAAA'), false)
  assert.equal(isRenderableFigureUrl('javascript:alert(1)'), false)
  assert.equal(isRenderableFigureUrl('https://user:pass@media.example.com/a.jpg'), false)
  assert.equal(isRenderableFigureUrl('not a url'), false)
})

test('isChapterCacheFresh 以 8 分钟为界', () => {
  const now = 1_800_000_000_000
  assert.equal(CHAPTER_ARTICLE_CACHE_TTL_MS, 8 * 60 * 1000)
  assert.equal(isChapterCacheFresh(now - 1_000, now), true)
  assert.equal(isChapterCacheFresh(now - CHAPTER_ARTICLE_CACHE_TTL_MS + 1, now), true)
  assert.equal(isChapterCacheFresh(now - CHAPTER_ARTICLE_CACHE_TTL_MS, now), false)
  assert.equal(isChapterCacheFresh(now + 1_000, now), false)
})

test('figureCaption 依次回退到 caption、alt 与 figure.alt', () => {
  assert.equal(figureCaption(figure, '行内 alt'), '均线多头排列')
  assert.equal(figureCaption({ ...figure, caption: '   ' }, '行内 alt'), '行内 alt')
  assert.equal(figureCaption({ ...figure, caption: undefined, alt: '服务端 alt' }, '  '), '服务端 alt')
})
