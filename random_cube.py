"""Random Cube — roll a die: a random number from 1 to N."""
import random


def roll(n: int) -> int:
    """Random integer from 1 to n, inclusive."""
    return random.randint(1, n)


def main() -> None:
    print("Random Cube. Press Enter on an empty line to quit.")
    while True:
        raw = input("Enter N (the die rolls a number from 1 to N): ").strip()
        if not raw:
            break
        if not raw.isdigit() or int(raw) < 1:
            print("Please enter a whole number of 1 or more.")
            continue
        print("You rolled:", roll(int(raw)))


if __name__ == "__main__":
    main()
