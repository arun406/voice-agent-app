cmake_minimum_required(VERSION 3.22)
project(llama_bridge)

# Pull in llama.cpp's own CMake build (vendored below as a plain checkout — see
# ../../../README.md for why this isn't a git submodule). It defines the `llama`
# and `ggml` targets we link against.
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
# Standalone mtmd (multimodal) library — vision support for describeImage(), without
# pulling in the full tools/ tree (CLI binaries we don't need). No video/audio input
# needed here, so leave MTMD_VIDEO at its default.
set(LLAMA_BUILD_MTMD ON CACHE BOOL "" FORCE)
add_subdirectory(llama.cpp)

add_library(llama_bridge SHARED llama_bridge.cpp)

find_library(log-lib log)

target_link_libraries(llama_bridge
    llama
    ggml
    mtmd
    ${log-lib}
)

target_include_directories(llama_bridge PRIVATE
    llama.cpp/include
    llama.cpp/ggml/include
    llama.cpp/tools/mtmd
)
