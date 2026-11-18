class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP 상태 코드
   * @param {string} message
   * @param {Record<string, string>} [details] 입력 검증 오류일 때 항목(필드)별 메시지
   */
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

module.exports = ApiError;
