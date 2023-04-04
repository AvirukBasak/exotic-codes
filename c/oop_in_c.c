#include <stdio.h>
#include <stdlib.h>
#include <math.h>

// ---------------- START complex.h --------------------

// declaring type before definition
typedef struct Complex Complex;

// defining struct
struct Complex {
    int x, y;
    // member function pointers
    Complex* (*add)    (Complex* this, Complex* z2);
    float    (*mod)    (Complex* this);
    float    (*theta)  (Complex* this);
    void     (*print)  (Complex* this);
    void     (*delete) (Complex* this);
};

// function prototypes: constructor and destructor
Complex* Complex_new     (int x, int y);
void     Complex_delete  (Complex* this);

// function prototypes: member functions
Complex* Complex_add     (Complex* this, Complex* z2);
float    Complex_mod     (Complex* this);
float    Complex_theta   (Complex* this);
void     Complex_print   (Complex* this);

// ------------------ END complex.h --------------------

// ----------------- START complex.c -------------------

// defining constructor
Complex* Complex_new(int x, int y)
{
    Complex* this = malloc(sizeof(Complex));
    // init values
    this->x = x;
    this->y = y;
    // assign function pointers to real functions
    // function definitions provided below
    this->add = Complex_add;
    this->mod = Complex_mod;
    this->theta = Complex_theta;
    this->print = Complex_print;
    this->delete = Complex_delete;
    return this;
}

// defining destructor
void Complex_delete(Complex* this)
{
    if (this) free(this);
}

// defining member functions
Complex* Complex_add(Complex* this, Complex* z2)
{
    Complex* z3 = Complex_new(this->x, this->y);
    z3->x += z2->x;
    z3->y += z2->y;
    return z3;
}

float Complex_mod(Complex* this)
{
    // sqrt and pow requires libm (standard math library)
    return sqrt(
        (float) pow(this->x, 2) + pow(this->y, 2)
    );
}

// returns in degrees
float Complex_theta(Complex* this)
{
    // atan: arctan or tan^(-1); requires libm (standard math library)
    return ( (float) 180 * atan(
        (float) this->y / this->x
    ) / M_PI );
}

void Complex_print(Complex* this)
{
    printf("%d + i%d\n", this->x, this->y);
}

// ----------------- END complex.c ---------------------

// main.c
int main()
{
    Complex* z = Complex_new(3, 4);    // 3, 4, 5 triangle
    z->print(z);
    float mod = z->mod(z);
    printf("mod = %lf\n", mod);
    printf("theta = %lf\n", z->theta(z));
    z->delete(z);
    return 0;
}
