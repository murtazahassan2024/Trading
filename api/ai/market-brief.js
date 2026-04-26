const { requestHandler } = require('../../server');

module.exports = function handler(req, res) {
  return requestHandler(req, res);
};
