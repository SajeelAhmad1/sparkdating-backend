const AppError = require('./appError');

function parseBody(schema, req) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new AppError(result.error.issues.map((issue) => issue.message).join(', '), 400);
  }

  return result.data;
}

function parseQuery(schema, req) {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw new AppError(result.error.issues.map((issue) => issue.message).join(', '), 400);
  }
  return result.data;
}

const PAGE_SIZE_DEFAULT = 10;

function parsePaginationQuery(query, { pageSize = PAGE_SIZE_DEFAULT } = {}) {
  const rawPage = parseInt(String(query.page ?? '1'), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { page, skip: (page - 1) * pageSize, take: pageSize, pageSize };
}

module.exports = {
  parseBody,
  parseQuery,
  parsePaginationQuery,
  PAGE_SIZE_DEFAULT
};
