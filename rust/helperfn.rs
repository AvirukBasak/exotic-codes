use std::io::{self, Write};
use std::path::Path;

/// Take an input as `String` and return a generic type `T`
/// after parsing that `String`.
/// 
/// In case of an input error, or if the input cannot be parsed
/// into type `T`, the function will panic. However, it can be
/// customized to return an `Option<T>` or `Result<T>` instead.
/// 
/// # Example
/// ```
/// // Using type annotaion in variable declaration
/// let x: i32 = input("Enter an integer: ");
///
/// // Passing a type parameter
/// let y = input::<f32>("Enter a float: ");
/// ```
pub fn input<T>(prompt: &str) -> T
where
    T: std::str::FromStr,
{
    print!("{}", prompt);
    io::stdout().flush().expect("prompt output error");
    let mut buf: String = String::new();
    io::stdin().read_line(&mut buf).expect("input error");
    match buf.trim().parse::<T>() {
        Ok(i) => i,
        Err(_) => panic!("invalid input"),
    }
}

/// Return the file basename of the current file,
/// given the output of the `file!()` macro.
/// 
/// # Example
/// ```
/// let filename = get_filename(file!());
/// ```
pub fn get_filename(filepath: &str) -> &str {
    Path::new(filepath)
        .file_name()
        .and_then(|s| s.to_str())
        .expect(stringify!(error getting filename))
}
