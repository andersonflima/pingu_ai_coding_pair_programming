if exists('g:loaded_pingu_test')
  finish
endif
let g:loaded_pingu_test = 1

function! PinguTestWordCount()
  echo pingu_test#word_count(getline('.'))
endfunction

command! PinguTestWordCount call PinguTestWordCount()
