def add_grading_flags(parser) -> None:
    parser.add_argument(
        '--anon',
        action='store_true',
        help='Use the "Alter Ego" column from students.csv as the student name '
             'in all generated Excel files',
    )
    parser.add_argument(
        '--follow-basis',
        default='auto',
        help='Which method to base remarks_<folder>.xlsx (and grades) on: '
             'ideal, required, leo, leo_star, lcs, lcs_star, lev, lev_star, '
             'ro, ro_star, git, git_star. Default "auto" prefers ideal, then '
             'required, then leo_star, then leo. All available bases get a '
             'remarks_<basis>.xlsx regardless of this choice.',
    )


def forward_grading_flags(args) -> list[str]:
    flags: list[str] = []
    if args.anon:
        flags.append('--anon')
    if args.follow_basis != 'auto':
        flags.append(f'--follow-basis={args.follow_basis}')
    return flags
