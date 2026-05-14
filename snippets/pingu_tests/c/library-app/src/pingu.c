#include <stdio.h>
#include "pingu.h"

int pingu_sum(int a, int b) {
    return a + b;
}

int main(void) {
    const int value = pingu_sum(1, 2);
    printf("Pingu C says: %d\n", value);
    return 0;
}
