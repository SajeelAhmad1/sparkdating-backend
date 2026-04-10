const AppError = require('./appError');

function parseBody(schema, req) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new AppError(result.error.issues.map((issue) => issue.message).join(', '), 400);
  }

  return result.data;
}

module.exports = {
  parseBody
};
