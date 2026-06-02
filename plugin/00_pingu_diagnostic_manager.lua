if vim.g.pingu_diagnostic_manager_bootstrapped == 1 then
  return
end

vim.g.pingu_diagnostic_manager_bootstrapped = 1

local diagnostic = vim.diagnostic
if type(diagnostic) ~= "table" or type(diagnostic.config) ~= "function" then
  return
end

local state = _G.__pingu_diagnostic_takeover or {}
_G.__pingu_diagnostic_takeover = state

state.original_config = state.original_config or diagnostic.config
if type(diagnostic.show) == "function" then
  state.original_show = state.original_show or diagnostic.show
end
if type(diagnostic.set) == "function" then
  state.original_set = state.original_set or diagnostic.set
end

local function takeover_enabled()
  return vim.g.pingu_diagnostic_takeover ~= 0
end

local function mask_diagnostic_opts(opts)
  local next_opts = type(opts) == "table" and vim.tbl_extend("force", {}, opts) or {}
  next_opts.virtual_text = false
  next_opts.virtual_lines = false
  next_opts.signs = false
  next_opts.underline = false
  return next_opts
end

local function mask_config_result(cfg)
  if type(cfg) ~= "table" then
    return cfg
  end
  return mask_diagnostic_opts(cfg)
end

if not state.config_wrapped then
  diagnostic.config = function(opts, namespace)
    local current = _G.__pingu_diagnostic_takeover
    local original = type(current) == "table" and current.original_config or state.original_config
    if type(current) == "table" and current.enabled and not current.restoring then
      if opts == nil then
        return mask_config_result(original(nil, namespace))
      end
      if type(opts) == "table" then
        return original(mask_diagnostic_opts(opts), namespace)
      end
    end
    return original(opts, namespace)
  end
  state.config_wrapped = true
end

if type(diagnostic.show) == "function" and not state.show_wrapped then
  diagnostic.show = function(namespace, bufnr, diagnostics, opts)
    local current = _G.__pingu_diagnostic_takeover
    local original = type(current) == "table" and current.original_show or state.original_show
    if type(original) ~= "function" then
      return nil
    end
    if type(current) == "table" and current.enabled and not current.restoring then
      return original(namespace, bufnr, diagnostics, mask_diagnostic_opts(opts))
    end
    return original(namespace, bufnr, diagnostics, opts)
  end
  state.show_wrapped = true
end

if type(diagnostic.set) == "function" and not state.set_wrapped then
  diagnostic.set = function(namespace, bufnr, diagnostics, opts)
    local current = _G.__pingu_diagnostic_takeover
    local original = type(current) == "table" and current.original_set or state.original_set
    if type(original) ~= "function" then
      return nil
    end
    if type(current) == "table" and current.enabled and not current.restoring then
      return original(namespace, bufnr, diagnostics, mask_diagnostic_opts(opts))
    end
    return original(namespace, bufnr, diagnostics, opts)
  end
  state.set_wrapped = true
end

state.enabled = takeover_enabled()
if state.enabled then
  diagnostic.config(mask_diagnostic_opts({}))
end
