local M = {}

local function normalize_line(value)
  return tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

function M.make_uppercase(text)
  return string.upper(normalize_line(text))
end

function M.report_lines(lines)
  local normalized = {}
  for index, value in ipairs(lines or {}) do
    table.insert(normalized, M.make_uppercase(value))
  end
  return normalized
end

return M
