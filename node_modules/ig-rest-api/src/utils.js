const { path, pipe, type, equals } = require("rambda");
const { createError } = require("./error");

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const isFunction = pipe(type, equals("Function"));
const isUndefined = pipe(type, equals("Undefined"));

function get(inputObject, inputPath, defaultValue) {
  const inputValue = path(inputPath, inputObject);
  return isUndefined(inputValue) ? defaultValue : inputValue;
}

exports.getOption = (key, options, defaults) => {
  return get(options, key, path(key, defaults));
};

exports.transformResponse = (response) => {
  return path("data", response);
};

exports.transformError = (error) => {
  throw createError(error);
};

exports.uniqueId = (length = 15, chars = CHARS) => {
  let i,
    result = "";
  for (i = length; i > 0; --i) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

exports.isFunction = isFunction;
exports.isUndefined = isUndefined;
