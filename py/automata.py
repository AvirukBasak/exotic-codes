class FiniteAutomaton:
    def __init__(self, start_state=None, end_states=None, trans_graph=None):
        if start_state and end_states and trans_graph:
            self.cur_state = start_state
            self.end_states = end_states if isinstance(end_states, tuple) else [ end_states ]
            self.trans_graph = trans_graph
        else:
            raise Error('malformed automaton initialisation')

    def process(self, inp_str):
        for char in inp_str:
            if char in self.trans_graph[self.cur_state]:
                self.cur_state = self.trans_graph[self.cur_state][char]
            else:
                return False
        return self.cur_state in self.end_states

    def mk_vars():
        import string
        alphabet = string.ascii_lowercase + string.ascii_uppercase
        for c in alphabet: globals()[c] = c

    # test examples
    def test():
        '''
        Expected o/p:
            ababaabbab aabb True
            ababaabbab abaab True
            ababaabbab not aabb False
        '''
        # Usage example: detects 'aabb'
        auto1 = FiniteAutomaton(A, E, {
            A: { a: B, b: A },
            B: { a: C, b: A },
            C: { a: C, b: D },
            D: { a: C, b: E },
            E: { a: E, b: E },
        })
        eg1 = 'ababaabbab'
        print(eg1, 'aabb', auto1.process(eg1))
        # Usage example: detects 'abaab'
        auto2 = FiniteAutomaton(A, F, {
            A: {a: B, b: A},
            B: {a: B, b: C},
            C: {a: D, b: A},
            D: {a: E, b: C},
            E: {a: B, b: F},
            F: {a: F, b: F},
        })
        eg2 = 'ababaabbab'
        print(eg2, 'abaab', auto2.process(eg2))
        # Usage example: detects not 'aabb'
        auto3 = FiniteAutomaton(A, ( A, B, C, D ), {
            A: { a: B, b: A },
            B: { a: C, b: A },
            C: { a: C, b: D },
            D: { a: C, b: E },
            E: { a: E, b: E },
        })
        eg3 = 'ababaabbab'
        print(eg3, 'not aabb', auto3.process(eg3))


if __name__ == '__main__':
    # allows the use of the alphabet for names of state or i/p
    FiniteAutomaton.mk_vars()
    # test examples
    FiniteAutomaton.test()
