#include <stdio.h>
#include <stdlib.h>

#define ASSIGN_TO_ARRAY(arr, ...) \
do { \
    const int num_args = sizeof((int[]){__VA_ARGS__}) / sizeof(int); \
    const int arr_size = sizeof(arr) / sizeof(arr[0]); \
    if (num_args > arr_size) { \
        fprintf(stderr, "Error: Too many arguments for array size\n"); \
        break; \
    } \
    int args[num_args]; \
    memcpy(args, (int[]){__VA_ARGS__}, num_args * sizeof(int)); \
    for (int i = 0; i < num_args; i++) { \
        arr[i] = args[i]; \
    } \
} while (0)
