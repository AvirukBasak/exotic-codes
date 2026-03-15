
/*

APPROACH: Parallel Tree Reduction
TYPE: EREW (No overlap b/w reads and writes b/w processors)

Work Done (a.k.a Cost) = P * T
Here, T = log n
      P = n/2 + n/4 + n/8 + ... = n
So Work Done = O(n log n)

*/

GenericTreeReductionEREW(A[n], n, f)
{
    for (k = 0; k <= log2(n)-1; k++) {
        for parallel ( i = 0; i <= n -1 -2^k; i += 2^(k+1) ) {
            A[i] = f(A[i], A[i + 2^k])
        }
    }
    output(A[0])
}

MaxEREW(A[n], n) = GenericTreeReductionEREW(A, n, MAX)
MinEREW(A[n], n) = GenericTreeReductionEREW(A, n, MIN)
SumEREW(A[n], n) = GenericTreeReductionEREW(A, n, SUM)

/*

APPROACH: N^2 Processors
TYPE: Common CRCW

Rows -> i
Cols -> j

      0   1   2   3   4
    +---+---+---+---+---+
 M: | 0 | 0 | 0 | 0 | 0 |
    +---+---+---+---+---+

Procesors N^2 (uncrossed):

      0   1   2   3   4
    +---+---+---+---+---+
  0 | x |   |   |   |   |
    +---+---+---+---+---+
  1 |   | x |   |   |   |
    +---+---+---+---+---+
  2 |   |   | x |   |   |
    +---+---+---+---+---+
  3 |   |   |   | x |   |
    +---+---+---+---+---+
  4 |   |   |   |   | x |
    +---+---+---+---+---+

*/

MinCRCW(A[n], n)
{
    var M[n]

    for parallel (i = 0; i < n; ++i) {
        M[i] = 0
    }

    for parallel (i = 0; i < n; ++i) {
        // for the ith number, all other no.s (j) > ith will write 1 in M[j]
        // this is to indicate that jth no is not the smallest (i.e. there is an ith < jth)
        for parallel (j = 0; j < n; ++j) {
            if (i != j) {
                if (A[i] < A[j]) {
                    M[j] = 1;
                }
            }
        }
    }

    // Only the min will have 0
    for parallel (i = 0; i < n; ++i) {
        if (M[i] == 0) output(A[i])
    }
}

/*

APPROACH: N^2 Processors
TYPE: Combining CRCW

Rows -> i
Cols -> j

      0   1   2   3   4
    +---+---+---+---+---+
 r: | 0 | 0 | 0 | 0 | 0 |
    +---+---+---+---+---+

Procesors N^2 (uncrossed):

      0   1   2   3   4
    +---+---+---+---+---+
  0 | x |   |   |   |   |
    +---+---+---+---+---+
  1 |   | x |   |   |   |
    +---+---+---+---+---+
  2 |   |   | x |   |   |
    +---+---+---+---+---+
  3 |   |   |   | x |   |
    +---+---+---+---+---+
  4 |   |   |   |   | x |
    +---+---+---+---+---+

*/

SortCRCW(A[n], n) 
{
    var r[n]
    var O[n]

    for parallel (i = 0; i < n; ++i) {
        r[i] = 0
    }

    for parallel (i = 0; i < n; ++i) {
        // for the ith number, all other no.s (j) > ith will add 1 in r[j]
        // this is to indicate no of no.s smaller than jth
        for parallel (j = 0; j < n; ++j) {
            if (i != j) {
                if (A[i] < A[j]) {
                    // Combining CRCW
                    ++r[j];
                }
            }
        }
    }

    // Only the min will have 0
    for parallel (i = 0; i < n; ++i) {
        O[r[i]] = A[i]
        output(O)
    }
}

/*

Graph Coloring
TYPE: CREW

Performance Analysis:
Number of comparisons done by each processor = n^2
Number of elements in the candidate array    = c^n
Sum of the elements in the candidate array   = O(log(C^n))

Overall Runtime complexity                   = O(n^2 + log(C^n))
                                             = O(n^2 + n*log(C))
                                             = O(n^2) (if C<<n)
*/

GraphColoringCREW(A[n][n], n, C)
{
    var candidate[C][C][C]...[C] // n dim bool matrix (C^n)
    var valid                    // no of valid colorings

    for parallel (0 <= i(0),i(1),i(2), ... i(n-1) < C) {
        candidate[i(0),i(1),i(2), ... i(n-1)] = 1

        for (j = 0; j < n; ++j) {
            for (k = 0; k < n; ++k) {
                if (A[j][k] && i(j) == i(k)) {
                    candidate[i(0),i(1),i(2), ... i(n-1)] = 0
                }
            }
        }

        valid = sum( candidate )
    }
    if (valid > 0) {
        output(true)
    } else {
        output(false)
    }
}
