cmake_minimum_required(VERSION 3.20)
project(pingu_c_app C)

add_library(pingu_lib STATIC src/pingu.c)
target_include_directories(pingu_lib PUBLIC include)

add_executable(pingu_demo src/pingu.c)
add_executable(pingu_test tests/test_pingu.c)
target_link_libraries(pingu_test PRIVATE pingu_lib)
enable_testing()
add_test(NAME pingu_test COMMAND pingu_test)
