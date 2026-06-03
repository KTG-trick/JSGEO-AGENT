const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.join(__dirname, '../../../skills');

/**
 * 解析 frontmatter
 * @param {string} content - markdown 内容
 * @returns {{ meta: object, content: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content };

  const frontmatter = {};
  match[1].split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (!key || !value) return;

    // 处理数组格式 [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim());
    } else {
      frontmatter[key] = value;
    }
  });

  return { meta: frontmatter, content: match[2] };
}

/**
 * 加载单个 skill
 * @param {string} skillName - skill 名称
 * @returns {object | null}
 */
function loadSkill(skillName) {
  const filePath = path.join(SKILLS_DIR, `${skillName}.md`);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const { meta, content: body } = parseFrontmatter(content);

  return {
    id: meta.name || skillName,
    name: meta.name || skillName,
    description: meta.description || '',
    visibility: meta.visibility || 'internal',
    platforms: meta.platforms || ['doubao', 'deepseek'],
    path: `file://${filePath}`,
    content: body,
  };
}

/**
 * 加载所有 skills
 * @returns {object[]}
 */
function loadAllSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  return fs
    .readdirSync(SKILLS_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => loadSkill(file.replace('.md', '')))
    .filter(Boolean);
}

/**
 * 获取用户可见的 skills
 * @returns {object[]}
 */
function getUserSkills() {
  return loadAllSkills().filter((skill) => skill.visibility === 'user');
}

/**
 * 获取内部 skills
 * @returns {object[]}
 */
function getInternalSkills() {
  return loadAllSkills().filter((skill) => skill.visibility === 'internal');
}

/**
 * 根据名称获取 skill
 * @param {string} skillName
 * @returns {object | null}
 */
function getSkill(skillName) {
  return loadSkill(skillName);
}

module.exports = {
  loadSkill,
  loadAllSkills,
  getUserSkills,
  getInternalSkills,
  getSkill,
};
