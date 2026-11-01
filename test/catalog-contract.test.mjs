import assert from 'node:assert/strict'
import test from 'node:test'
import { getCatalogChapter, getCatalogCourse } from '../lib/host/cloud-client.js'
import { InvalidResponseError } from '../lib/errors.js'

const signal = new AbortController().signal

function stub(payload, status = 200) {
  return {
    request: async () => new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  }
}

const chapterSummary = {
  chapterId: 'M1',
  title: '第一章 趋势认知',
  position: 0,
  hasArticle: true,
  figureCount: 1,
  knowledgePoints: [],
}

function coursePayload(contractVersion) {
  return {
    ...(contractVersion === undefined ? {} : { contractVersion }),
    courseId: 'TC-101',
    title: '趋势交易基础',
    chapters: [chapterSummary],
  }
}

function chapterPayload(overrides = {}) {
  return {
    chapterId: 'M1',
    courseId: 'TC-101',
    title: '第一章 趋势认知',
    article: {
      markdown: '# 趋势\n\n![均线示意](figure:fig_demo1)\n\n正文。',
      version: 1,
      publishedAt: 1_760_000_000_000,
    },
    figures: {
      fig_demo1: {
        url: 'https://media.example.com/figures/fig_demo1/cand_1.jpg?expires=1&sig=x',
        width: 1600,
        height: 900,
        alt: '均线示意',
      },
    },
    adjacentChapters: [{ chapterId: 'M2', title: '第二章' }],
    ...overrides,
  }
}

test('catalogCourse 对 contractVersion 缺失按 1 处理并拒绝旧内容', async () => {
  for (const version of [undefined, 1]) {
    await assert.rejects(
      getCatalogCourse(stub(coursePayload(version)), 'TC-101', signal),
      (error) => error instanceof InvalidResponseError
        && error.message === '课程内容版本过旧，请在后台重新生成并发布',
      String(version),
    )
  }
})

test('catalogCourse 接受 contractVersion=2 并规范化', async () => {
  const course = await getCatalogCourse(stub(coursePayload(2)), 'TC-101', signal)
  assert.equal(course.contractVersion, 2)
  assert.equal(course.chapters[0].hasArticle, true)
  assert.equal(course.chapters[0].figureCount, 1)
})

test('catalogCourse 拒绝高于已知上限的版本', async () => {
  await assert.rejects(
    getCatalogCourse(stub(coursePayload(3)), 'TC-101', signal),
    (error) => error instanceof InvalidResponseError
      && error.message === '课程内容已升级，请更新插件后再试',
  )
})

test('catalogCourse 拒绝缺少 hasArticle/figureCount 的章节', async () => {
  const payload = coursePayload(2)
  delete payload.chapters[0].hasArticle
  await assert.rejects(
    getCatalogCourse(stub(payload), 'TC-101', signal),
    (error) => error instanceof InvalidResponseError
      && error.message === '课程服务返回的课程结构不合法',
  )

  const tooManyFigures = coursePayload(2)
  tooManyFigures.chapters[0].figureCount = 4
  await assert.rejects(
    getCatalogCourse(stub(tooManyFigures), 'TC-101', signal),
    (error) => error instanceof InvalidResponseError,
  )
})

test('catalogCourse 拒绝 courseId 不一致的响应', async () => {
  await assert.rejects(
    getCatalogCourse(stub({ ...coursePayload(2), courseId: 'TC-999' }), 'TC-101', signal),
    (error) => error instanceof InvalidResponseError,
  )
})

test('catalogChapter 返回正文、图示与相邻章节', async () => {
  const chapter = await getCatalogChapter(stub(chapterPayload()), 'TC-101', 'M1', signal)
  assert.equal(chapter.chapterId, 'M1')
  assert.equal(chapter.article.version, 1)
  assert.equal(chapter.figures.fig_demo1.width, 1600)
  assert.deepEqual(chapter.adjacentChapters, [{ chapterId: 'M2', title: '第二章' }])
})

test('catalogChapter 允许未发布教材（article=null）', async () => {
  const chapter = await getCatalogChapter(
    stub(chapterPayload({ article: null, figures: {} })),
    'TC-101',
    'M1',
    signal,
  )
  assert.equal(chapter.article, null)
})

test('catalogChapter 拒绝正文引用未下发的图示', async () => {
  await assert.rejects(
    getCatalogChapter(stub(chapterPayload({ figures: {} })), 'TC-101', 'M1', signal),
    (error) => error instanceof InvalidResponseError
      && error.message === '章节教材引用了未下发的图示',
  )
})

test('catalogChapter 拒绝非 http(s)、带凭据或越界尺寸的图示', async () => {
  const cases = [
    { url: 'data:image/png;base64,AAAA' },
    { url: 'javascript:alert(1)' },
    { url: 'https://user:pass@media.example.com/a.jpg' },
    { width: 799 },
    { height: 20_001 },
    { alt: '' },
    { caption: 'x'.repeat(201) },
  ]
  for (const overrides of cases) {
    const payload = chapterPayload()
    payload.figures.fig_demo1 = { ...payload.figures.fig_demo1, ...overrides }
    await assert.rejects(
      getCatalogChapter(stub(payload), 'TC-101', 'M1', signal),
      (error) => error instanceof InvalidResponseError,
      JSON.stringify(overrides),
    )
  }
})

test('catalogChapter 拒绝超长正文与超过 3 张图示', async () => {
  const long = chapterPayload()
  long.article.markdown = 'a'.repeat(20_001)
  await assert.rejects(
    getCatalogChapter(stub(long), 'TC-101', 'M1', signal),
    (error) => error instanceof InvalidResponseError,
  )

  const many = chapterPayload()
  for (let index = 1; index <= 4; index += 1) {
    many.figures[`fig_demo${index}`] = { ...many.figures.fig_demo1 }
  }
  await assert.rejects(
    getCatalogChapter(stub(many), 'TC-101', 'M1', signal),
    (error) => error instanceof InvalidResponseError,
  )
})

test('catalogChapter 拒绝章节响应与请求不一致', async () => {
  for (const overrides of [{ chapterId: 'M2' }, { courseId: 'TC-999' }]) {
    await assert.rejects(
      getCatalogChapter(stub(chapterPayload(overrides)), 'TC-101', 'M1', signal),
      (error) => error instanceof InvalidResponseError,
    )
  }
})

test('catalogChapter 拒绝非法章节 ID 且不发起请求', async () => {
  let called = false
  const auth = { request: async () => { called = true; return new Response('{}') } }
  await assert.rejects(getCatalogChapter(auth, 'TC-101', 'bad/chapter', signal))
  assert.equal(called, false)
})
