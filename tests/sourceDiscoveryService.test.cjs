const test = require('node:test');
const assert = require('node:assert/strict');

const { selectSourceDiscoveryQuestions } = require('../src/main/services/sourceDiscoveryService.cjs');

test('selectSourceDiscoveryQuestions prefers ranking questions and limits search count', () => {
  const questionSetRow = {
    questions_json: JSON.stringify({
      ranking_questions: ['q3', 'q1'],
      candidate_questions: [
        { id: 'q1', question: '成都汽车音响改装哪家推荐？', intent: 'ranking_rec', priority: 9 },
        { id: 'q2', question: '汽车隔音施工怎么避坑？', intent: 'educational_trust', priority: 5 },
        { id: 'q3', question: '成都汽车隔音公司排名有哪些？', intent: 'ranking_rec', priority: 10 },
        { id: 'q4', question: '不同汽车音响品牌怎么对比？', intent: 'comparison', priority: 8 },
      ],
    }),
  };
  const confirmedQuestions = [
    { id: 'q1', question: '成都汽车音响改装哪家推荐？', intent: 'ranking_rec', priority: 9 },
    { id: 'q2', question: '汽车隔音施工怎么避坑？', intent: 'educational_trust', priority: 5 },
    { id: 'q3', question: '成都汽车隔音公司排名有哪些？', intent: 'ranking_rec', priority: 10 },
    { id: 'q4', question: '不同汽车音响品牌怎么对比？', intent: 'comparison', priority: 8 },
  ];

  const selected = selectSourceDiscoveryQuestions(questionSetRow, null, confirmedQuestions, 3);

  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map((item) => item.id), ['q3', 'q1', 'q4']);
});

test('selectSourceDiscoveryQuestions falls back to confirmed questions when ranking list is short', () => {
  const questionSetRow = {
    questions_json: JSON.stringify({
      ranking_questions: ['q2'],
      candidate_questions: [
        { id: 'q1', question: '全国预制菜供应商推荐？', intent: 'ranking_rec', priority: 9 },
        { id: 'q2', question: '火锅丸滑供应商排行榜有哪些？', intent: 'ranking_rec', priority: 10 },
        { id: 'q3', question: '酱料定制厂家怎么比较？', intent: 'comparison', priority: 8 },
      ],
    }),
  };
  const confirmedQuestions = [
    { id: 'q1', question: '全国预制菜供应商推荐？', intent: 'ranking_rec', priority: 9 },
    { id: 'q2', question: '火锅丸滑供应商排行榜有哪些？', intent: 'ranking_rec', priority: 10 },
    { id: 'q3', question: '酱料定制厂家怎么比较？', intent: 'comparison', priority: 8 },
  ];

  const selected = selectSourceDiscoveryQuestions(questionSetRow, null, confirmedQuestions, 3);

  assert.deepEqual(selected.map((item) => item.id), ['q2', 'q1', 'q3']);
});
