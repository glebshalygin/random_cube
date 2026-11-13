"""Random Cube — бросок кубика: случайное число от 1 до N."""
import random


def roll(n: int) -> int:
    """Случайное целое от 1 до n включительно."""
    return random.randint(1, n)


def main() -> None:
    print("Random Cube. Пустая строка — выход.")
    while True:
        raw = input("Введите N (кубик выдаст число от 1 до N): ").strip()
        if not raw:
            break
        if not raw.isdigit() or int(raw) < 1:
            print("Нужно целое число от 1 и больше.")
            continue
        print("Выпало:", roll(int(raw)))


if __name__ == "__main__":
    main()
