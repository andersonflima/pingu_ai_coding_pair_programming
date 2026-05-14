local plugin = require('pingu_test')

assert(type(plugin.make_uppercase('  x ')) == 'string')
assert(plugin.make_uppercase('x') == 'X')
assert(#plugin.report_lines({'a', 'b'}) == 2)
