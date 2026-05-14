function! pingu_test#word_count(text)
  let l:normalized = trim(a:text)
  if empty(l:normalized)
    return 0
  endif
  return len(split(l:normalized, '\s\+'))
endfunction

function! pingu_test#format_status()
  return {'status': 'ok', 'service': 'pingu-vim'}
endfunction
