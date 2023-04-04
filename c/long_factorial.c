#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <math.h>

/** owns a and b, and frees them */
char *multiply(char *a, char *b) {
    int len_a = strlen(a);
    int len_b = strlen(b);
    int len_res = len_a + len_b;
    char *res = (char*) malloc(len_res + 64);
    memset(res, '0', len_res);
    res[len_res] = '\0';
    for (int i = len_b - 1; i >= 0; i--) {
        int carry = 0;
        for (int j = len_a - 1; j >= 0; j--) {
            int product = (b[i] - '0') * (a[j] - '0') + carry + (res[i+j+1] - '0');
            res[i+j+1] = (product % 10) + '0';
            carry = product / 10;
        }
        res[i] += carry;
    }
    free(a);
    free(b);
    return res;
}

char *x = NULL;

char *factorial(int n_) {
    if (n_ < 0) return "";
    if (n_ <= 1) return "1";
    char *res = (char*) malloc(64);
    sprintf(res, "%d", 1);
    while (n_) {
        char *n = (char*) malloc( (int) ceil(log10(n_)) * sizeof(char) +64);
        sprintf(n, "%d", n_);
        res = multiply(res, n);
        --n_;
    }
    x = res;
    while (*res == '0' && *(res+1) != '\0')
        res++;
    return res;
}

int main(int argc, char **argv) {
    if (argc < 2) abort();
    int n = atoi(argv[1]);
    char *res = factorial(n);
    printf("%d! = %s\n", n, res);
    free(x);
}

/* TEST:
 * 69! = 171122452428141311372468338881272839092270544893520369393648040923257279754140647424000000000000000
 */
